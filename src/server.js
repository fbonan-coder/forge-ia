import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { Store } from "./db.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { createAgent } from "./agent.js";
import { json, readJson, safeSlug } from "./http.js";
import { listWorkspaceFiles } from "./workspace-files.js";
import { CheckpointManager } from "./checkpoint-manager.js";

const store = new Store(config.dataDir);
const workspaces = new WorkspaceManager(config.workspacesDir);
const agent = createAgent(config);
const checkpointFiles = new CheckpointManager(
  path.join(config.dataDir, "checkpoints"),
  config.workspacesDir,
);
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const APP_VERSION = "0.6.1";

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

function projectOrThrow(id) {
  const project = store.getProject(id);
  if (!project || project.archived_at) throw Object.assign(new Error("Project not found"), { status: 404 });
  return project;
}

async function api(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") {
    return json(response, 200, {
      ok: true,
      agent: config.agentProvider,
      version: APP_VERSION,
    });
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

  const match = pathname.match(/^\/api\/projects\/([0-9a-f-]+)(?:\/(open|suspend|archive|messages|runs|checkpoints|files))?$/);
  if (!match) return json(response, 404, { error: "Not found" });
  const [, id, action] = match;
  const project = projectOrThrow(id);

  if (request.method === "GET" && !action) return json(response, 200, { project });
  if (request.method === "POST" && action === "open") {
    if (!fs.existsSync(project.workspace_path)) {
      fs.mkdirSync(path.join(project.workspace_path, "src"), { recursive: true });
    }
    const openedAt = new Date().toISOString();
    const updated = store.updateProject(id, {
      state: "active",
      dev_url: `/preview/${project.id}/`,
      last_opened_at: openedAt,
    });
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
  if (request.method === "GET" && action === "files") {
    const latestRun = store.listRuns(id).find((run) => run.status === "succeeded") || null;
    return json(response, 200, listWorkspaceFiles(project, latestRun));
  }
  if (request.method === "POST" && action === "runs") {
    const body = await readJson(request);
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return json(response, 422, { error: "A prompt is required" });
    store.addMessage(id, "user", prompt);
    const run = store.createRun(id, prompt, config.anthropicModel);
    try {
      const automaticCheckpoint = store.addCheckpoint(
        id,
        `Avant : ${prompt.slice(0, 80)}`,
      );
      checkpointFiles.create(project, automaticCheckpoint.id);
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
    const checkpoints = store.listCheckpoints(id).map((checkpoint) => ({
      ...checkpoint,
      available: checkpointFiles.exists(id, checkpoint.id),
    }));
    return json(response, 200, { checkpoints });
  }
  if (request.method === "POST" && action === "checkpoints") {
    const body = await readJson(request);
    if (body.restoreId) {
      const target = store.listCheckpoints(id).find(
        (checkpoint) => checkpoint.id === String(body.restoreId),
      );
      if (!target) return json(response, 404, { error: "Checkpoint not found" });

      const safety = store.addCheckpoint(id, "Avant restauration");
      checkpointFiles.create(project, safety.id);
      checkpointFiles.restore(project, target.id);
      return json(response, 200, {
        restored: target,
        safetyCheckpoint: safety,
      });
    }
    const checkpoint = store.addCheckpoint(id, String(body.label || "Checkpoint manuel"), body.commitSha, body.deploymentUrl);
    checkpointFiles.create(project, checkpoint.id);
    return json(response, 201, { checkpoint });
  }
  return json(response, 405, { error: "Method not allowed" });
}

function sendFile(response, file) {
  const extension = path.extname(file).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType.startsWith("text/")
      ? `${contentType}; charset=utf-8`
      : contentType,
    "x-content-type-options": "nosniff",
    "cache-control": "no-cache",
  });
  fs.createReadStream(file).pipe(response);
}

function previewFile(response, pathname) {
  const match = pathname.match(/^\/preview\/([0-9a-f-]+)(?:\/(.*))?$/);
  if (!match) return false;

  const [, projectId, requestedPath = ""] = match;
  const project = projectOrThrow(projectId);
  const workspace = path.resolve(project.workspace_path);
  let relativePath;

  try {
    relativePath = decodeURIComponent(requestedPath) || "index.html";
  } catch {
    throw Object.assign(new Error("Invalid preview path"), { status: 400 });
  }

  let file = path.resolve(workspace, relativePath);
  if (file !== workspace && !file.startsWith(workspace + path.sep)) {
    throw Object.assign(new Error("Invalid preview path"), { status: 403 });
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const fallback = path.join(workspace, "index.html");
    if (fs.existsSync(fallback) && fs.statSync(fallback).isFile()) {
      file = fallback;
    } else {
      throw Object.assign(new Error("Preview file not found"), { status: 404 });
    }
  }

  sendFile(response, file);
  return true;
}

function staticFile(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(publicDir, relative);
  if (
    !file.startsWith(publicDir + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) return false;
  sendFile(response, file);
  return true;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(request) {
  const expectedPassword = process.env.FORGE_PASSWORD;
  if (!expectedPassword) return true;

  const expectedUsername = process.env.FORGE_USERNAME || "forge";
  const authorization = request.headers.authorization || "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  try {
    const credentials = Buffer.from(encoded, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    if (separator < 0) return false;
    return (
      secureEqual(credentials.slice(0, separator), expectedUsername) &&
      secureEqual(credentials.slice(separator + 1), expectedPassword)
    );
  } catch {
    return false;
  }
}

const server = http.createServer(async (request, response) => {
  if (!isAuthorized(request)) {
    response.writeHead(401, {
      "www-authenticate": 'Basic realm="Forge IA"',
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end("Authentication required");
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(request, response, url.pathname);
    if (request.method === "GET" && url.pathname.startsWith("/preview/")) {
      previewFile(response, url.pathname);
      return;
    }
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
