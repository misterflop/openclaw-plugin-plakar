import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Minimal mock of the OpenClaw plugin API
// ---------------------------------------------------------------------------

function makeApi({ location = "", paths = [], extraPaths = [], timeout = 15000, passphrase = "", s3AccessKey = "", s3SecretKey = "" } = {}) {
  const warnings = [];
  const infos = [];
  const hooks = [];

  return {
    pluginConfig: { location, paths, extraPaths, timeout, passphrase, s3AccessKey, s3SecretKey },
    logger: {
      warn(msg) { warnings.push(msg); },
      info(msg) { infos.push(msg); },
      error(msg) { infos.push(msg); },
    },
    on(event, handler, opts) {
      hooks.push({ event, handler, opts });
    },
    _warnings: warnings,
    _infos: infos,
    _hooks: hooks,
  };
}

// ---------------------------------------------------------------------------
// Snapshot of the SNAPSHOT_TRIGGER_PREFIXES logic (mirrors index.js)
// ---------------------------------------------------------------------------

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

function shouldSnapshot(toolName) {
  return SNAPSHOT_TRIGGER_PREFIXES.some((p) => toolName.startsWith(p));
}

// ---------------------------------------------------------------------------
// Minimal register() reimplementation for unit tests
// ---------------------------------------------------------------------------

function register(api, { plakarInPath = true, storeAddSuccess = true } = {}) {
  // Graceful degradation 1: plakar in PATH
  if (!plakarInPath) {
    api.logger.warn(
      "[plakar] 'plakar' binary not found in PATH — snapshots disabled.\n" +
      "         Install: https://docs.plakar.io/install\n" +
      "         Then restart OpenClaw and configure plakar.location in your config."
    );
    return;
  }

  // Graceful degradation 2: store location configured
  const config = api.pluginConfig ?? {};
  const location = config.location ?? config.store;
  if (!location) {
    api.logger.warn(
      "[plakar] plakar.location not configured — snapshots disabled.\n" +
      "         Set it with: openclaw config set plugins.entries.openclaw-plugin-plakar.config.location <path-or-url>"
    );
    return;
  }

  // Setup named store (simplified mock)
  if (storeAddSuccess) {
    api.logger.info(`[plakar] named store registered: @openclaw-backup → ${location}`);
  } else {
    api.logger.warn("[plakar] failed to register named store — falling back to direct path");
  }

  api.logger.info("[plakar] plugin registered — store: " + location);
}

// ---------------------------------------------------------------------------
// Handler logic extracted for testing (mirrors index.js)
// ---------------------------------------------------------------------------

async function runHandler(ctx, api, { execFn = execSync } = {}) {
  if (!shouldSnapshot(ctx.toolName)) return { skipped: true };

  const config = api.pluginConfig ?? {};
  const storeRef = config.location ?? config.store;
  const paths = config.paths ?? [];
  const extraPaths = config.extraPaths ?? [];
  const timeout = config.timeout ?? 15000;
  const passphrase = config.passphrase;
  const targets = paths.length ? paths : [process.cwd(), ...extraPaths];
  const cmd = `plakar -no-agent -quiet at ${storeRef} backup -no-xattr ${targets.join(" ")}`;

  const env = passphrase ? { PLAKAR_PASSPHRASE: passphrase } : undefined;

  try {
    const stdout = execFn(cmd, { timeout, stdio: "pipe", env })?.toString().trim() ?? "";
    const snapshotId = stdout.split(/\s+/)[0] ?? "(unknown)";
    api.logger.info(`[plakar] snapshot ${snapshotId} (${ctx.toolName})`);
    return { ran: true, cmd, env };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.logger.warn(`[plakar] snapshot failed for ${ctx.toolName}: ${message}`);
    return { ran: true, failed: true, cmd };
  }
}

// ---------------------------------------------------------------------------
// Test 1: registers without throwing when plakar is absent
// ---------------------------------------------------------------------------

test("registers without throwing when plakar is absent", () => {
  const api = makeApi({ location: "/data/store" });
  assert.doesNotThrow(() => register(api, { plakarInPath: false }));
  assert.ok(api._warnings.some((w) => w.includes("not found in PATH")));
});

// ---------------------------------------------------------------------------
// Test 2: registers without throwing when plakar.location is not set
// ---------------------------------------------------------------------------

test("registers without throwing when plakar.location is not configured", () => {
  const api = makeApi({ location: "" });
  assert.doesNotThrow(() => register(api, { plakarInPath: true }));
  assert.ok(api._warnings.some((w) => w.includes("plakar.location not configured")));
});

// ---------------------------------------------------------------------------
// Test 3: before_tool_call fires for fs.write.* tool names
// ---------------------------------------------------------------------------

test("handler runs for fs.write.* tool names", async () => {
  const api = makeApi({ location: "/data/store" });
  const execFn = () => Buffer.from("abc123 snapshot created");
  const result = await runHandler({ toolName: "fs.write.file" }, api, { execFn });
  assert.equal(result.ran, true);
  assert.ok(api._infos.some((m) => m.includes("abc123")));
});

// ---------------------------------------------------------------------------
// Test 4: before_tool_call does NOT fire for fs.read.* tool names
// ---------------------------------------------------------------------------

test("handler is skipped for fs.read.* tool names", async () => {
  const api = makeApi({ location: "/data/store" });
  let execCalled = false;
  const execFn = () => { execCalled = true; return Buffer.from(""); };
  const result = await runHandler({ toolName: "fs.read.file" }, api, { execFn });
  assert.equal(result.skipped, true);
  assert.equal(execCalled, false);
});

// ---------------------------------------------------------------------------
// Test 5: snapshot command is constructed correctly
// ---------------------------------------------------------------------------

test("snapshot command is constructed correctly from config values", async () => {
  const api = makeApi({ location: "/data/plakar-store", paths: ["/workspace", "/etc/app"] });
  let capturedCmd;
  const execFn = (cmd) => { capturedCmd = cmd; return Buffer.from("snap-42"); };
  await runHandler({ toolName: "shell.exec.run" }, api, { execFn });
  assert.equal(capturedCmd, "plakar -no-agent -quiet at /data/plakar-store backup -no-xattr /workspace /etc/app");
});

// ---------------------------------------------------------------------------
// Test 6: timeout/failure does not block the tool call
// ---------------------------------------------------------------------------

test("timeout/failure does not block the tool call", async () => {
  const api = makeApi({ location: "/data/store", timeout: 100 });
  const execFn = () => { throw Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }); };
  let threw = false;
  try {
    await runHandler({ toolName: "fs.delete.file" }, api, { execFn });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.ok(api._warnings.some((w) => w.includes("snapshot failed")));
});

// ---------------------------------------------------------------------------
// Test 7: passphrase is passed as PLAKAR_PASSPHRASE env var
// ---------------------------------------------------------------------------

test("passphrase is passed as PLAKAR_PASSPHRASE env var", async () => {
  const api = makeApi({ location: "/data/store", passphrase: "s3cr3t" });
  let capturedEnv;
  const execFn = (cmd, opts) => { capturedEnv = opts.env; return Buffer.from("snap-99"); };
  await runHandler({ toolName: "write.file" }, api, { execFn });
  assert.equal(capturedEnv?.PLAKAR_PASSPHRASE, "s3cr3t");
});

// ---------------------------------------------------------------------------
// Test 8: bare verb prefixes (write, delete, exec) also trigger snapshot
// ---------------------------------------------------------------------------

test("bare verb prefixes trigger snapshots", async () => {
  const api = makeApi({ location: "/data/store" });
  let callCount = 0;
  const execFn = () => { callCount++; return Buffer.from("snap-id"); };
  await runHandler({ toolName: "write" }, api, { execFn });
  await runHandler({ toolName: "delete.something" }, api, { execFn });
  await runHandler({ toolName: "exec.bash" }, api, { execFn });
  assert.equal(callCount, 3);
});

// ---------------------------------------------------------------------------
// Test 9: extraPaths are appended to cwd, not replacing it
// ---------------------------------------------------------------------------

test("extraPaths appends to workspace dir, not replaces it", async () => {
  const api = makeApi({ location: "/data/store", extraPaths: ["/data/postgres", "/etc/app"] });
  let capturedCmd;
  const execFn = (cmd) => { capturedCmd = cmd; return Buffer.from("snap-id"); };
  await runHandler({ toolName: "write.file" }, api, { execFn });
  assert.ok(capturedCmd.includes(process.cwd()), "should include cwd");
  assert.ok(capturedCmd.includes("/data/postgres"), "should include extra path 1");
  assert.ok(capturedCmd.includes("/etc/app"), "should include extra path 2");
});

// ---------------------------------------------------------------------------
// Test 10: paths (override) replaces cwd + extraPaths entirely
// ---------------------------------------------------------------------------

test("paths override replaces workspace and extraPaths entirely", async () => {
  const api = makeApi({
    location: "/data/store",
    paths: ["/override/only"],
    extraPaths: ["/data/postgres"],
  });
  let capturedCmd;
  const execFn = (cmd) => { capturedCmd = cmd; return Buffer.from("snap-id"); };
  await runHandler({ toolName: "write.file" }, api, { execFn });
  assert.ok(capturedCmd.includes("/override/only"), "should include override path");
  assert.ok(!capturedCmd.includes(process.cwd()), "should NOT include cwd");
  assert.ok(!capturedCmd.includes("/data/postgres"), "should NOT include extraPaths when paths is set");
});
