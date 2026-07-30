import path from "node:path";

export const config = {
  port: Number(process.env.PORT || 8787),
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  workspacesDir: path.resolve(process.env.WORKSPACES_DIR || "./workspaces"),
  agentProvider: process.env.AGENT_PROVIDER || "mock",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  maxBudgetUsd: Number(process.env.MAX_BUDGET_USD || 2),
};
