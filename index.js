import { execSync } from "node:child_process";

const SNAPSHOT_TRIGGER_PREFIXES = [
  "write",
  "delete",
  "move",
  "exec",
  // Legacy / future fs.* namespaced variants
  "fs.write",
  "fs.delete",
  "fs.move",
  "shell.exec",
];

function makeSnapshotHandler(store, api) {
  return async (ctx) => {
    const shouldSnapshot = SNAPSHOT_TRIGGER_PREFIXES.some((p) =>
      ctx.toolName.startsWith(p)
    );
    if (!shouldSnapshot) return;

    const paths = api.pluginConfig?.paths ?? [];
    const timeout = api.pluginConfig?.timeout ?? 15000;
    const targets = paths.length ? paths : [process.cwd()];
    const cmd = `plakar -no-agent at ${store} backup ${targets.join(" ")}`;

    try {
      const stdout = execSync(cmd, { timeout, stdio: "pipe" }).toString().trim();
      const snapshotId = stdout.split(/\s+/)[0] ?? "(unknown)";
      api.logger.info(`[plakar] snapshot ${snapshotId} (${ctx.toolName})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      api.logger.warn(`[plakar] snapshot failed for ${ctx.toolName}: ${message}`);
      // Graceful degradation 3: never block the tool call
    }
  };
}

export default {
  id: "openclaw-plugin-plakar",
  name: "Plakar Backup",

  register(api) {
    // Graceful degradation 1: plakar binary must be in PATH
    try {
      execSync("which plakar", { stdio: "ignore" });
    } catch {
      api.logger.warn(
        "[plakar] 'plakar' binary not found in PATH — snapshots disabled.\n" +
        "         Install: https://docs.plakar.io/install\n" +
        "         Then restart OpenClaw and set plakar.store in your config."
      );
      return;
    }

    // Graceful degradation 2: store must be configured
    const store = api.pluginConfig?.store;
    if (!store) {
      api.logger.warn(
        "[plakar] plakar.store not configured — snapshots disabled.\n" +
        "         Set it with: openclaw config set plakar.store <path-or-url>"
      );
      return;
    }

    api.logger.info("[plakar] plugin registered — store: " + store);

    const handler = makeSnapshotHandler(store, api);
    api.on("before_tool_call", handler);
    api.on("after_tool_call", handler);
  },
};
