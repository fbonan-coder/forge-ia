import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { Store } from "./db.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { createAgent } from "./agent.js";
import { json, readJson, safeSlug } from "./http.js";

const store = new Store(config.dataDir);
const workspaces = new WorkspaceManager(config.workspacesDir);
const agent = createAgent(config);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

function projectOrThrow(id) {
  const project = store.getProject(id);
  if (!project || project.archived_at) throw Object.assign(new Error("Project not found"), { status: 404 });
  return project;
}

async function api(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") {
    return json(response, 200, { ok: true, agent: config.agentProvider });
  }
  if (request.method === "GET" && pathname === "/api/projects") {
    return json(response, 200, { projects: store.listProjects() });
  }
  if (request.method === "POST" && pathname === "/api/projects") {
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const slug = safeSlug(body.slug || name);
    if (name.length < 2 || !slug) return json(response, 422, { error: "A name is required" });
    let workspace;
    try {
      workspace = workspaces.create(slug);
      const project = store.createProject({ name, slug, description: String(body.description || ""), workspacePath: workspace });
      store.addMessage(project.id, "user", String(body.description || `Créer ${name}`));
      return json(response, 201, { project });
    } catch (error) {
      if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
      if (String(error.message).includes("UNIQUE")) return json(response, 409, { error: "Slug already exists" });
      throw error;
    }
  }

  const match = pathname.match(/^\/api\/projects\/([0-9a-f-]+)(?:\/(open|suspend|archive|messages|runs|checkpoints))?$/);
  if (!match) return json(response, 404, { error: "Not found" });
  const [, id, action] = match;
  const project = projectOrThrow(id);

  if (request.method === "GET" && !action) return json(response, 200, { project });
  if (request.method === "POST" && action === "open") {
    const runtime = workspaces.open(project);
    const updated = store.updateProject(id, { state: runtime.state, dev_url: runtime.devUrl, last_opened_at: runtime.openedAt });
    return json(response, 200, { project: updated });
  }
  if (request.method === "POST" && action === "suspend") {
    const runtime = workspaces.suspend(project);
    return json(response, 200, { project: store.updateProject(id, { state: runtime.state }) });
  }
  if (request.method === "POST" && action === "archive") {
    return json(response, 200, { project: store.updateProject(id, { state: "archived", archived_at: new Date().toISOString() }) });
  }
  if (request.method === "GET" && action === "messages") {
    return json(response, 200, { messages: store.listMessages(id) });
  }
  if (request.method === "GET" && action === "runs") {
    return json(response, 200, { runs: store.listRuns(id) });
  }
  if (request.method === "POST" && action === "runs") {
    const body = await readJson(request);
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return json(response, 422, { error: "A prompt is required" });
    store.addMessage(id, "user", prompt);
    const run = store.createRun(id, prompt, config.anthropicModel);
    try {
      const result = await agent.run({ project, prompt });
      const finished = store.finishRun(run.id, { status: "succeeded", ...result });
      store.addMessage(id, "assistant", result.text);
      const totalCost = Number(project.total_cost_usd) + Number(result.costUsd || 0);
      store.updateProject(id, { total_cost_usd: totalCost });
      return json(response, 200, { run: finished, message: result.text });
    } catch (error) {
      const failed = store.finishRun(run.id, { status: "failed", error: error.message });
      return json(response, 500, { error: error.message, run: failed });
    }
  }
  if (request.method === "GET" && action === "checkpoints") {
    return json(response, 200, { checkpoints: store.listCheckpoints(id) });
  }
  if (request.method === "POST" && action === "checkpoints") {
    const body = await readJson(request);
    const checkpoint = store.addCheckpoint(id, String(body.label || "Checkpoint manuel"), body.commitSha, body.deploymentUrl);
    return json(response, 201, { checkpoint });
  }
  return json(response, 405, { error: "Method not allowed" });
}

function staticFile(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file)) return false;
  const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
  response.writeHead(200, { "content-type": `${type}; charset=utf-8`, "x-content-type-options": "nosniff" });
  fs.createReadStream(file).pipe(response);
  return true;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(request, response, url.pathname);
    if (request.method === "GET" && staticFile(response, url.pathname)) return;
    json(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    json(response, error.status || 500, { error: error.status ? error.message : "Internal server error" });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Forge IA listening on http://localhost:${config.port}`);
});
