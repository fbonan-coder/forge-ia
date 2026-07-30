import fs from "node:fs";
import path from "node:path";

function assertInsideWorkspace(workspace, candidate) {
  const root = path.resolve(workspace);
  const target = path.resolve(candidate);

  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Path escapes workspace");
  }
}

export class MockAgent {
  async run({ project, prompt }) {
    const output = path.join(
      project.workspace_path,
      "src",
      "last-request.md"
    );

    assertInsideWorkspace(project.workspace_path, output);

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(
      output,
      `# Latest request\n\n${prompt}\n`,
      "utf8"
    );

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
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }

    if (!project.workspace_path) {
      throw new Error("Project workspace is missing");
    }

    const workspace = path.resolve(project.workspace_path);

    if (!fs.existsSync(workspace)) {
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const { query } = await import(
      "@anthropic-ai/claude-agent-sdk"
    );

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;

    const conversation = query({
      prompt,
      options: {
        cwd: workspace,
        model: this.model,

        allowedTools: [
          "Read",
          "Glob",
          "Grep",
          "Edit",
          "Write",
        ],

        permissionMode: "acceptEdits",
        maxBudgetUsd: this.maxBudgetUsd,

        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: [
            "Work only inside the current project workspace.",
            "Never read or modify parent or sibling directories.",
            "Do not access environment variables or secrets.",
            "Create or modify the requested application files directly.",
            "At the end, summarize the changes clearly in French.",
          ].join(" "),
        },
      },
    });

    for await (const message of conversation) {
      if (message.type === "assistant") {
        const blocks = message.message?.content || [];

        const assistantText = blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");

        if (assistantText) {
          text += `${assistantText}\n`;
        }
      }

      if (message.type === "result") {
        if (message.is_error) {
          throw new Error(
            message.result ||
              message.error ||
              "Claude Agent execution failed"
          );
        }

        costUsd = Number(message.total_cost_usd || 0);
        inputTokens = Number(message.usage?.input_tokens || 0);
        outputTokens = Number(message.usage?.output_tokens || 0);

        if (!text && message.result) {
          text = String(message.result);
        }
      }
    }

    return {
      text: text.trim() || "Modification terminée.",
      inputTokens,
      outputTokens,
      costUsd,
    };
  }
}

export function createAgent(config) {
  if (config.agentProvider === "claude") {
    return new ClaudeAgent({
      model: config.anthropicModel,
      maxBudgetUsd: config.maxBudgetUsd,
    });
  }

  return new MockAgent();
}
