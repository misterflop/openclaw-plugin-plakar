# openclaw-plugin-plakar

## Project goal
An OpenClaw plugin that automatically triggers a Plakar snapshot before and after
every filesystem-mutating or shell-executing tool call made by the agent.
Published to npm and listed on ClawHub.

---

## Repository layout (target)

```
openclaw-plugin-plakar/
├── CLAUDE.md                     ← this file
├── package.json                  ← npm package + openclaw.extensions declaration
├── openclaw.plugin.json          ← OpenClaw plugin manifest
├── index.js                      ← plugin entry point (ESM)
├── hooks/
│   └── plakar-snapshot/
│       ├── HOOK.md               ← hook metadata + eligibility rules
│       └── handler.ts            ← HookHandler for before_tool_call / after_tool_call
├── skills/
│   └── plakar-backup/
│       └── SKILL.md              ← bundled skill: teaches the agent restore workflows
├── test/
│   └── plugin.test.js            ← unit tests with node:test (no external test runner)
└── README.md                     ← user-facing install + config guide
```

---

## OpenClaw extension model — what matters here

### Plugin entry point (`index.js`)
Must export a default function `register(api)` OR an object
`{ id, name, configSchema, register(api) {} }`.

The `api` object exposes:
- `api.registerHook(event, handler, { name, description })` — registers a runtime hook
- `api.on(event, handler, { priority })` — typed lifecycle hook (synchronous, used for
  `before_prompt_build`, `before_tool_call`, `after_tool_call`, `tool_result_persist`)
- `api.config` — live plugin config (read via `api.config.get("plakar.store")`)
- `api.logger` — structured logger (`api.logger.info / warn / error`)
- `registerPluginHooksFromDir(api, "./hooks")` — helper from `openclaw/plugin-sdk`
  that discovers HOOK.md + handler.ts pairs automatically

### Relevant hook events
| Event | When it fires | Use here |
|---|---|---|
| `before_tool_call` | Before any tool execution | snapshot pre-condition |
| `after_tool_call` | After tool result is available | snapshot post-condition |
| `tool_result_persist` | Synchronous, before transcript write | not needed here |
| `command:new` / `command:stop` | /new and /stop commands | session-end snapshot |

### Package manifest requirements
`package.json` must declare:
```json
{
  "openclaw": {
    "extensions": ["index.js"]
  }
}
```

`openclaw.plugin.json` must exist at root with at minimum:
```json
{
  "id": "plakar",
  "name": "Plakar Backup",
  "configSchema": { ... }
}
```

### Plugin install constraint
`openclaw plugins install` accepts **registry-only npm specs** (name + version/tag).
Git, URL, and file specs are rejected. Keep the dependency tree pure JS/TS —
`--ignore-scripts` is enforced during install, so no postinstall builds.

### Hook discovery (bundled inside plugin)
Use `registerPluginHooksFromDir(api, "./hooks")` from `openclaw/plugin-sdk`.
Each hook is a directory under `hooks/` with:
- `HOOK.md` — YAML frontmatter (`name`, `description`, `events`, `requires`)
- `handler.ts` — exports a `HookHandler` function (typed from `openclaw/plugin-sdk`)

Plugin-managed hooks appear in `openclaw hooks list` as `plugin:plakar`.
They cannot be toggled via `openclaw hooks enable/disable` — only via the plugin itself.

---

## Tool filtering logic

Only snapshot when the tool call is destructive. Filter on `ctx.toolName`:

```
SNAPSHOT_TRIGGER_PREFIXES = [
  "fs.write",
  "fs.delete",
  "fs.move",
  "shell.exec",
]
```

Do NOT snapshot on: `fs.read`, `browser.*`, `canvas.*`, `memory.*`, `search.*`.

---

## Plakar integration

### Binary requirement
`plakar` must be in `$PATH`. The hook declares this in `HOOK.md` frontmatter:
```yaml
requires:
  bins:
    - plakar
```
If the binary is absent at load time, OpenClaw marks the hook as ineligible and
skips it silently. The plugin must log a clear warning at startup in this case.

### Store configuration
The store path is **user-configured only** — no hardcoded default.
Read from plugin config:
```js
const store = api.config.get("plakar.store"); // e.g. "/data/plakar-store" or "s3://..."
if (!store) {
  api.logger.warn("[plakar] plakar.store not configured — snapshots disabled");
  return;
}
```

Config schema to expose in `openclaw.plugin.json`:
```json
{
  "configSchema": {
    "type": "object",
    "properties": {
      "store": {
        "type": "string",
        "description": "Plakar store path or URL (e.g. /data/plakar-store or s3://bucket/prefix)"
      },
      "paths": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Paths to snapshot. Defaults to the agent workspace directory.",
        "default": []
      },
      "timeout": {
        "type": "integer",
        "description": "Snapshot timeout in milliseconds",
        "default": 15000
      }
    },
    "required": ["store"]
  }
}
```

### Snapshot command
```
plakar -s <store> push <path1> [<path2> ...]
```

### Graceful degradation rules (non-negotiable)
1. If `plakar` is not in PATH → log warning at startup, disable hooks, never throw
2. If `plakar.store` is not configured → log warning at startup, disable hooks, never throw
3. If snapshot times out or exits non-zero → log warning, **do not block the tool call**
4. If snapshot succeeds → log info with snapshot ID if stdout provides one

---

## Skill (bundled)

`skills/plakar-backup/SKILL.md` teaches the agent:
- How to list snapshots: `plakar -s <store> ls`
- How to restore a specific snapshot: `plakar -s <store> pull <snapshot-id> <path>`
- How to diff two snapshots (if supported)
- When to offer restore (user says "undo", "rollback", "restore", "revert")

The skill does NOT handle triggering snapshots — that is the plugin's job.
The skill is purely about **restore workflows** visible to the agent.

---

## Tests (`test/plugin.test.js`)

Use `node:test` (built-in, Node 22). No Jest, no Vitest.

Cover:
1. Plugin registers without throwing when `plakar` is absent (graceful degradation)
2. Plugin registers without throwing when `plakar.store` is not set
3. `before_tool_call` hook fires for `fs.write.*` tool names
4. `before_tool_call` hook does NOT fire for `fs.read.*` tool names
5. Snapshot command is constructed correctly from config values
6. Timeout is respected (mock `execSync` / `spawnSync`)

---

## Publishing checklist

### npm
- `name`: `openclaw-plugin-plakar`
- `version`: semver starting at `0.1.0`
- `main`: `index.js`
- `type`: `module` (ESM)
- `engines`: `{ "node": ">=22" }`
- `keywords`: `["openclaw", "plakar", "backup", "plugin"]`
- `files`: `["index.js", "hooks/", "skills/", "openclaw.plugin.json", "README.md"]`
- No postinstall script (rejected by OpenClaw's `--ignore-scripts`)

### ClawHub
- Publish the bundled skill (`skills/plakar-backup/`) separately to ClawHub
  so it is discoverable without installing the full plugin
- Skill slug: `plakar-backup`
- Tag: `backup`, `filesystem`, `resilience`

---

## Code style
- ESM only (`import`/`export`), no CommonJS
- No external runtime dependencies except `openclaw/plugin-sdk` (peer dependency)
- `execSync` from `node:child_process` for the Plakar CLI call
- Concise variable names: `store`, `paths`, `timeout`, `ctx`, `api`
- All errors caught, never propagated — plugin must be transparent to the agent

---

## Key reference URLs
- Plugin API: https://docs.openclaw.ai/tools/plugin
- Hook events: https://docs.openclaw.ai/tools/hooks
- Hook handler type: `import type { HookHandler } from "openclaw/plugin-sdk"`
- Plakar CLI reference: https://docs.plakar.io/cli
- ClawHub publish guide: https://clawhub.com/publish
