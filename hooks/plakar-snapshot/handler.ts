import { execSync } from "node:child_process";
import type { HookHandler } from "openclaw/plugin-sdk";

const SNAPSHOT_TRIGGER_PREFIXES = [
  "fs.write",
  "fs.delete",
  "fs.move",
  "shell.exec",
];

interface ToolCallContext {
  toolName: string;
  toolArgs: unknown;
  result?: unknown;
}

const handler: HookHandler<ToolCallContext> = async (ctx, api) => {
  // Filter: only snapshot on mutating / shell-executing tools
  const shouldSnapshot = SNAPSHOT_TRIGGER_PREFIXES.some((prefix) =>
    ctx.toolName.startsWith(prefix)
  );
  if (!shouldSnapshot) return;

  const store = api.config.get("plakar.store") as string;
  const paths = (api.config.get("plakar.paths") as string[] | undefined) ?? [];
  const timeout = (api.config.get("plakar.timeout") as number | undefined) ?? 15000;

  const targets = paths.length ? paths : [process.cwd()];
  const cmd = `plakar -s ${store} push ${targets.join(" ")}`;

  try {
    const stdout = execSync(cmd, { timeout, stdio: "pipe" }).toString().trim();
    // Plakar prints the snapshot ID as the first token of its output line
    const snapshotId = stdout.split(/\s+/)[0] ?? "(unknown)";
    api.logger.info(`[plakar] snapshot ${snapshotId} (${ctx.toolName})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.logger.warn(`[plakar] snapshot failed for ${ctx.toolName}: ${message}`);
    // Graceful degradation 3: never block the tool call
  }
};

export default handler;
