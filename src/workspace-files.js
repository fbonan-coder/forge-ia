import fs from "node:fs";
import path from "node:path";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

const textExtensions = new Set([
  ".css", ".csv", ".html", ".js", ".jsx", ".json", ".md", ".mjs",
  ".scss", ".svg", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml",
]);

function isSecretFile(name) {
  const lower = name.toLowerCase();
  return lower === ".env" ||
    lower.startsWith(".env.") ||
    lower.includes("credential") ||
    lower.includes("secret") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key");
}

export function listWorkspaceFiles(project, latestRun = null) {
  const root = path.resolve(project.workspace_path);
  if (!fs.existsSync(root)) return { files: [], latestRunStartedAt: null };

  const latestRunStartedAt = latestRun?.started_at || null;
  const latestRunTime = latestRunStartedAt ? Date.parse(latestRunStartedAt) : 0;
  const files = [];

  function visit(directory) {
    if (files.length >= 500) return;

    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name);
      });

    for (const entry of entries) {
      if (files.length >= 500) break;
      if (entry.name.startsWith(".") || isSecretFile(entry.name)) continue;

      const absolutePath = path.resolve(directory, entry.name);
      if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) continue;

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const stats = fs.statSync(absolutePath);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      const extension = path.extname(entry.name).toLowerCase();
      const readable = textExtensions.has(extension) || extension === "";

      let content = null;
      if (readable && stats.size <= 300_000) {
        content = fs.readFileSync(absolutePath, "utf8");
      }

      files.push({
        path: relativePath,
        name: entry.name,
        extension: extension.slice(1) || "text",
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        changedInLastRun: Boolean(latestRunTime && stats.mtimeMs >= latestRunTime),
        readable,
        content,
      });
    }
  }

  visit(root);
  return { files, latestRunStartedAt };
}
