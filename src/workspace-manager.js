import fs from "node:fs";
import path from "node:path";

export class WorkspaceManager {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  pathFor(slug) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Invalid project slug");
    const target = path.resolve(this.root, slug);
    if (!target.startsWith(this.root + path.sep)) throw new Error("Workspace escapes root");
    return target;
  }

  create(slug) {
    const workspace = this.pathFor(slug);
    fs.mkdirSync(workspace, { recursive: false });
    fs.writeFileSync(path.join(workspace, "README.md"), `# ${slug}\n\nCreated by Forge IA.\n`);
    fs.mkdirSync(path.join(workspace, "src"));
    fs.writeFileSync(path.join(workspace, "src", "main.js"), `console.log("Hello from ${slug}");\n`);
    return workspace;
  }

  open(project) {
    if (!fs.existsSync(project.workspace_path)) throw new Error("Workspace not found");
    return {
      state: "active",
      devUrl: project.dev_url || `http://${project.slug}.dev.local`,
      openedAt: new Date().toISOString(),
    };
  }

  suspend() {
    return { state: "sleep" };
  }
}
