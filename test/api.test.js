import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/db.js";
import { WorkspaceManager } from "../src/workspace-manager.js";
import { safeSlug } from "../src/http.js";

test("projects are isolated and persist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-"));
  const store = new Store(path.join(root, "data"));
  const workspaces = new WorkspaceManager(path.join(root, "workspaces"));
  const auraPath = workspaces.create("aura");
  const devoluPath = workspaces.create("devolu");
  const aura = store.createProject({ name: "Aura", slug: "aura", description: "", workspacePath: auraPath });
  const devolu = store.createProject({ name: "Devolu", slug: "devolu", description: "", workspacePath: devoluPath });
  store.addMessage(aura.id, "user", "Aura only");
  store.addMessage(devolu.id, "user", "Devolu only");
  assert.notEqual(aura.workspace_path, devolu.workspace_path);
  assert.equal(store.listMessages(aura.id)[0].content, "Aura only");
  assert.equal(store.listMessages(devolu.id)[0].content, "Devolu only");
  fs.rmSync(root, { recursive: true, force: true });
});

test("slug normalization is safe", () => {
  assert.equal(safeSlug("Dévolu Capital !!!"), "devolu-capital");
  assert.equal(safeSlug("../../etc/passwd"), "etc-passwd");
});
