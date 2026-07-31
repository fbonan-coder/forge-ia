import fs from "node:fs";
import path from "node:path";

const ignoredDirectories = new Set([
  ".git", ".next", ".nuxt", ".cache", "node_modules",
  "dist", "build", "coverage",
]);

function validId(value) {
  return /^[0-9a-f-]+$/i.test(String(value));
}

export class CheckpointManager {
  constructor(root, workspacesRoot) {
    this.root = path.resolve(root);
    this.workspacesRoot = path.resolve(workspacesRoot);
    fs.mkdirSync(this.root, { recursive: true });
  }

  workspaceFor(project) {
    const workspace = path.resolve(project.workspace_path);
    if (!workspace.startsWith(this.workspacesRoot + path.sep)) {
      throw new Error("Workspace escapes root");
    }
    return workspace;
  }

  checkpointFor(projectId, checkpointId) {
    if (!validId(projectId) || !validId(checkpointId)) {
      throw new Error("Invalid checkpoint identifier");
    }
    const target = path.resolve(this.root, projectId, checkpointId);
    if (!target.startsWith(this.root + path.sep)) {
      throw new Error("Checkpoint escapes root");
    }
    return target;
  }

  copyFilter(source) {
    const name = path.basename(source);
    if (ignoredDirectories.has(name)) return false;
    return true;
  }

  create(project, checkpointId) {
    const workspace = this.workspaceFor(project);
    const target = this.checkpointFor(project.id, checkpointId);
    const temporary = `${target}.tmp`;

    if (!fs.existsSync(workspace)) throw new Error("Workspace not found");
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(workspace, temporary, {
      recursive: true,
      force: true,
      filter: (source) => this.copyFilter(source),
    });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(temporary, target);
    return target;
  }

  exists(projectId, checkpointId) {
    return fs.existsSync(this.checkpointFor(projectId, checkpointId));
  }

  restore(project, checkpointId) {
    const workspace = this.workspaceFor(project);
    const source = this.checkpointFor(project.id, checkpointId);
    if (!fs.existsSync(source)) throw new Error("Checkpoint files not found");

    fs.mkdirSync(workspace, { recursive: true });
    for (const entry of fs.readdirSync(workspace)) {
      fs.rmSync(path.join(workspace, entry), { recursive: true, force: true });
    }
    fs.cpSync(source, workspace, { recursive: true, force: true });
  }
}
