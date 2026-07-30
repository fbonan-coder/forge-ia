import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export class Store {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "forge.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'sleep',
        workspace_path TEXT NOT NULL,
        dev_url TEXT,
        repository_url TEXT,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        commit_sha TEXT,
        deployment_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id, created_at);
    `);
  }

  listProjects() {
    return this.db.prepare(
      `SELECT * FROM projects WHERE archived_at IS NULL ORDER BY
       CASE state WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC`,
    ).all();
  }

  getProject(id) {
    return this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  }

  createProject({ name, slug, description, workspacePath }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO projects
      (id,name,slug,description,state,workspace_path,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, name, slug, description || "", "sleep", workspacePath, now, now);
    return this.getProject(id);
  }

  updateProject(id, changes) {
    const allowed = ["state", "dev_url", "repository_url", "total_cost_usd", "archived_at", "last_opened_at"];
    const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getProject(id);
    const now = new Date().toISOString();
    const sets = entries.map(([key]) => `${key} = ?`).concat("updated_at = ?");
    this.db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`)
      .run(...entries.map(([, value]) => value), now, id);
    return this.getProject(id);
  }

  addMessage(projectId, role, content) {
    const row = { id: randomUUID(), project_id: projectId, role, content, created_at: new Date().toISOString() };
    this.db.prepare("INSERT INTO messages VALUES (?,?,?,?,?)")
      .run(row.id, row.project_id, row.role, row.content, row.created_at);
    return row;
  }

  listMessages(projectId) {
    return this.db.prepare("SELECT * FROM messages WHERE project_id = ? ORDER BY created_at").all(projectId);
  }

  createRun(projectId, prompt, model) {
    const row = { id: randomUUID(), project_id: projectId, prompt, status: "running", model, started_at: new Date().toISOString() };
    this.db.prepare(`
      INSERT INTO runs (id,project_id,prompt,status,model,started_at) VALUES (?,?,?,?,?,?)
    `).run(row.id, row.project_id, row.prompt, row.status, row.model, row.started_at);
    return this.getRun(row.id);
  }

  finishRun(id, result) {
    this.db.prepare(`
      UPDATE runs SET status=?, input_tokens=?, output_tokens=?, cost_usd=?, error=?, finished_at=? WHERE id=?
    `).run(result.status, result.inputTokens || 0, result.outputTokens || 0, result.costUsd || 0,
      result.error || null, new Date().toISOString(), id);
    return this.getRun(id);
  }

  getRun(id) {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  }

  listRuns(projectId) {
    return this.db.prepare("SELECT * FROM runs WHERE project_id=? ORDER BY started_at DESC").all(projectId);
  }

  addCheckpoint(projectId, label, commitSha = null, deploymentUrl = null) {
    const row = { id: randomUUID(), project_id: projectId, label, commit_sha: commitSha, deployment_url: deploymentUrl, created_at: new Date().toISOString() };
    this.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?,?,?)")
      .run(row.id, row.project_id, row.label, row.commit_sha, row.deployment_url, row.created_at);
    return row;
  }

  listCheckpoints(projectId) {
    return this.db.prepare("SELECT * FROM checkpoints WHERE project_id=? ORDER BY created_at DESC").all(projectId);
  }
}
