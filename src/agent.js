import fs from "node:fs";
import path from "node:path";

function assertInsideWorkspace(workspace, candidate) {
  const root = path.resolve(workspace);
  const target = path.resolve(candidate);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path escapes workspace");
}

export class MockAgent {
  async run({ project, prompt }) {
    const output = path.join(project.workspace_path, "src", "last-request.md");
    assertInsideWorkspace(project.workspace_path, output);
    fs.writeFileSync(output, `# Latest request\n\n${prompt}\n`);
    await new Promise((resolve) => setTimeout(resolve, 180));
    return {
      text: `J’ai enregistré la demande dans l’espace isolé de ${project.name}.`,
      inputTokens: Math.max(20, Math.round(prompt.length / 4)),
      outputTokens: 24,
      costUsd: 0,
    };
  }
}

export class ClaudeAgent {
  constructor({ model, maxBudgetUsd }) {
    this.model = model;
    this.maxBudgetUsd = maxBudgetUsd;
  }

  async run({ project, prompt }) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;

    for await (const message of query({
      prompt,
      options: {
        cwd: project.workspace_path,
        model: this.model,
        allowedTools: ["Read", "Glob", "Grep", "Edit", "Write"],
        permissionMode: "acceptEdits",
        maxBudgetUsd: this.maxBudgetUsd,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "Work only inside the current project. Never read or modify parent or sibling directories. Do not access secrets.",
        },
      },
    })) {
      if (message.type === "assistant") {
        text += message.message?.content
          ?.filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n") || "";
      }
      if (message.type === "result") {
        costUsd = message.total_cost_usd || 0;
        inputTokens = message.usage?.input_tokens || 0;
        outputTokens = message.usage?.output_tokens || 0;
      }
    }
    return { text: text || "Modification terminée.", inputTokens, outputTokens, costUsd };
  }
}

export function createAgent(config) {
  return config.agentProvider === "claude"
    ? new ClaudeAgent({ model: config.anthropicModel, maxBudgetUsd: config.maxBudgetUsd })
    : new MockAgent();
}
