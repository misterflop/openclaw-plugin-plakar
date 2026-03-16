import { execSync } from "node:child_process";
import type { HookHandler } from "openclaw/plugin-sdk";

const SNAPSHOT_TRIGGER_PREFIXES = [
  "write",
  "delete",
  "move",
  "exec",
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
  const shouldSnapshot = SNAPSHOT_TRIGGER_PREFIXES.some((prefix) =>
    ctx.toolName.startsWith(prefix)
  );
  if (!shouldSnapshot) return;

  const config = (api as any).pluginConfig ?? {};
  const storeRef = config._storeRef ?? config.location ?? config.store;
  if (!storeRef) return;

  const paths = (config.paths as string[] | undefined) ?? [];
  const extraPaths = (config.extraPaths as string[] | undefined) ?? [];
  const timeout = (config.timeout as number | undefined) ?? 15000;
  const passphrase = config.passphrase as string | undefined;

  const targets = paths.length ? paths : [process.cwd(), ...extraPaths];
  const cmd = `plakar -no-agent -quiet at ${storeRef} backup -no-xattr ${targets.join(" ")}`;

  const env = passphrase
    ? { ...process.env, PLAKAR_PASSPHRASE: passphrase }
    : undefined;

  try {
    const stdout = execSync(cmd, { timeout, stdio: "pipe", env }).toString().trim();
    const snapshotId = stdout.split(/\s+/)[0] ?? "(unknown)";
    api.logger.info(`[plakar] snapshot ${snapshotId} (${ctx.toolName})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.logger.warn(`[plakar] snapshot failed for ${ctx.toolName}: ${message}`);
    // Graceful degradation 3: never block the tool call
  }
};

export default handler;
