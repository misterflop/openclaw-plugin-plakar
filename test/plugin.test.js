import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Minimal mock of the OpenClaw plugin API
// ---------------------------------------------------------------------------

function makeApi({ store = "", paths = [], timeout = 15000 } = {}) {
  const warnings = [];
  const infos = [];
  const hooks = [];

  return {
    pluginConfig: { store, paths, timeout },
    logger: {
      warn(msg) { warnings.push(msg); },
      info(msg) { infos.push(msg); },
      error(msg) { infos.push(msg); },
    },
    on(event, handler, opts) {
      hooks.push({ event, handler, opts });
    },
    // registerPluginHooksFromDir is a no-op in unit tests;
    // we test the handler directly
    _warnings: warnings,
    _infos: infos,
    _hooks: hooks,
  };
}

// ---------------------------------------------------------------------------
// Snapshot of the SNAPSHOT_TRIGGER_PREFIXES logic (mirrors handler.ts)
// ---------------------------------------------------------------------------

const SNAPSHOT_TRIGGER_PREFIXES = [
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
// (avoids importing openclaw/plugin-sdk which is not installed in CI)
// ---------------------------------------------------------------------------

function register(api, { plakarInPath = true } = {}) {
  // Graceful degradation 1: plakar in PATH
  if (!plakarInPath) {
    api.logger.warn(
      "[plakar] 'plakar' binary not found in PATH — snapshots disabled.\n" +
      "         Install: https://docs.plakar.io/install\n" +
      "         Then restart OpenClaw and set plakar.store in your config."
    );
    return;
  }

  // Graceful degradation 2: store configured
  const store = api.pluginConfig?.store;
  if (!store) {
    api.logger.warn(
      "[plakar] plakar.store not configured — snapshots disabled.\n" +
      "         Set it with: openclaw config set plakar.store <path-or-url>"
    );
    return;
  }

  api.logger.info("[plakar] plugin registered — store: " + store);
}

// ---------------------------------------------------------------------------
// Handler logic extracted for testing (mirrors handler.ts)
// ---------------------------------------------------------------------------

async function runHandler(ctx, api, { execFn = execSync } = {}) {
  if (!shouldSnapshot(ctx.toolName)) return { skipped: true };

  const store = api.pluginConfig?.store;
  const paths = api.pluginConfig?.paths ?? [];
  const timeout = api.pluginConfig?.timeout ?? 15000;
  const targets = paths.length ? paths : [process.cwd()];
  const cmd = `plakar -no-agent at ${store} backup ${targets.join(" ")}`;

  try {
    const stdout = execFn(cmd, { timeout, stdio: "pipe" })?.toString().trim() ?? "";
    const snapshotId = stdout.split(/\s+/)[0] ?? "(unknown)";
    api.logger.info(`[plakar] snapshot ${snapshotId} (${ctx.toolName})`);
    return { ran: true, cmd };
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
  const api = makeApi({ store: "/data/store" });
  assert.doesNotThrow(() => register(api, { plakarInPath: false }));
  assert.ok(api._warnings.some((w) => w.includes("not found in PATH")));
});

// ---------------------------------------------------------------------------
// Test 2: registers without throwing when plakar.store is not set
// ---------------------------------------------------------------------------

test("registers without throwing when plakar.store is not configured", () => {
  const api = makeApi({ store: "" });
  assert.doesNotThrow(() => register(api, { plakarInPath: true }));
  assert.ok(api._warnings.some((w) => w.includes("plakar.store not configured")));
});

// ---------------------------------------------------------------------------
// Test 3: before_tool_call fires for fs.write.* tool names
// ---------------------------------------------------------------------------

test("handler runs for fs.write.* tool names", async () => {
  const api = makeApi({ store: "/data/store" });
  const execFn = () => Buffer.from("abc123 snapshot created");
  const result = await runHandler({ toolName: "fs.write.file" }, api, { execFn });
  assert.equal(result.ran, true);
  assert.ok(api._infos.some((m) => m.includes("abc123")));
});

// ---------------------------------------------------------------------------
// Test 4: before_tool_call does NOT fire for fs.read.* tool names
// ---------------------------------------------------------------------------

test("handler is skipped for fs.read.* tool names", async () => {
  const api = makeApi({ store: "/data/store" });
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
  const api = makeApi({ store: "/data/plakar-store", paths: ["/workspace", "/etc/app"] });
  let capturedCmd;
  const execFn = (cmd) => { capturedCmd = cmd; return Buffer.from("snap-42"); };
  await runHandler({ toolName: "shell.exec.run" }, api, { execFn });
  assert.equal(capturedCmd, "plakar -no-agent at /data/plakar-store backup /workspace /etc/app");
});

// ---------------------------------------------------------------------------
// Test 6: timeout is respected — non-zero exit does not throw
// ---------------------------------------------------------------------------

test("timeout/failure does not block the tool call", async () => {
  const api = makeApi({ store: "/data/store", timeout: 100 });
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
