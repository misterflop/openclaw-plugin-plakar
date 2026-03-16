import { execSync } from "node:child_process";

const SNAPSHOT_TRIGGER_PREFIXES = [
  "write",
  "delete",
  "move",
  "exec",
  // Namespaced variants
  "fs.write",
  "fs.delete",
  "fs.move",
  "shell.exec",
];

const NAMED_STORE = "openclaw-backup";

/**
 * Register (or re-register) the named store with plakar.
 * Returns the store reference to use in commands: "@openclaw-backup" on success,
 * or the raw location as fallback if store registration fails.
 */
function setupNamedStore(config, api) {
  const location = config?.location ?? config?.store; // backward compat
  if (!location) return null;

  // Remove existing registration (idempotent — ignore errors if not found)
  try {
    execSync(`plakar -no-agent store rm ${NAMED_STORE}`, { stdio: "ignore" });
  } catch { /* not found or other benign error */ }

  // Build options for S3 / MinIO stores
  const opts = [];
  if (config.s3AccessKey) opts.push(`access_key=${config.s3AccessKey}`);
  if (config.s3SecretKey) opts.push(`secret_access_key=${config.s3SecretKey}`);
  if (config.s3UseTls !== undefined) opts.push(`use_tls=${config.s3UseTls}`);
  if (config.s3StorageClass) opts.push(`storage_class=${config.s3StorageClass}`);

  const cmd = ["plakar", "-no-agent", "store", "add", NAMED_STORE, location, ...opts].join(" ");

  try {
    execSync(cmd, { stdio: "pipe" });
    api.logger.info(`[plakar] named store registered: @${NAMED_STORE} → ${location}`);
    return `@${NAMED_STORE}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.logger.warn(`[plakar] failed to register named store: ${message} — falling back to direct path`);
    return location;
  }
}

function makeSnapshotHandler(storeRef, api) {
  return async (ctx) => {
    const shouldSnapshot = SNAPSHOT_TRIGGER_PREFIXES.some((p) =>
      ctx.toolName.startsWith(p)
    );
    if (!shouldSnapshot) return;

    const paths = api.pluginConfig?.paths ?? [];
    const extraPaths = api.pluginConfig?.extraPaths ?? [];
    const timeout = api.pluginConfig?.timeout ?? 15000;
    const passphrase = api.pluginConfig?.passphrase;
    // `paths` overrides everything; `extraPaths` appends to the default workspace dir
    const targets = paths.length
      ? paths
      : [process.cwd(), ...extraPaths];
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
        "         Then restart OpenClaw and configure plakar.location in your config."
      );
      return;
    }

    // Graceful degradation 2: store location must be configured
    const config = api.pluginConfig ?? {};
    const location = config.location ?? config.store;
    if (!location) {
      api.logger.warn(
        "[plakar] plakar.location not configured — snapshots disabled.\n" +
        "         Set it with: openclaw config set plugins.entries.openclaw-plugin-plakar.config.location <path-or-url>"
      );
      return;
    }

    const storeRef = setupNamedStore(config, api);
    if (!storeRef) {
      api.logger.warn("[plakar] could not determine store reference — snapshots disabled.");
      return;
    }

    const handler = makeSnapshotHandler(storeRef, api);
    api.on("before_tool_call", handler);
    api.on("after_tool_call", handler);
  },
};
