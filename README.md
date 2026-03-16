# openclaw-plugin-plakar

An [OpenClaw](https://docs.openclaw.ai) plugin that automatically captures a
[Plakar](https://plakar.io) snapshot of your workspace **before and after**
every filesystem-mutating or shell-executing tool call made by the agent.

No code is snapshotted unless you configure it — the plugin is fully inert
until `plakar.store` is set.

---

## Prerequisites

1. **Node.js ≥ 22**
2. **OpenClaw** installed and running
3. **Plakar** binary in your `$PATH`

Install Plakar: https://docs.plakar.io/install

---

## Install

```bash
openclaw plugins install openclaw-plugin-plakar
```

---

## Configuration

Set the required `store` option (all other options have defaults):

```bash
# Required: path or URL to your Plakar store
openclaw config set plakar.store /data/plakar-store
# or an S3 store:
openclaw config set plakar.store s3://my-bucket/plakar

# Optional: paths to snapshot (defaults to the agent workspace directory)
openclaw config set plakar.paths '["/workspace", "/etc/myapp"]'

# Optional: snapshot timeout in milliseconds (default: 15000)
openclaw config set plakar.timeout 30000
```

---

## What gets snapshotted

Snapshots are triggered by tool calls whose names start with:

| Prefix | Examples |
|---|---|
| `fs.write` | file writes, file creation |
| `fs.delete` | file deletion |
| `fs.move` | rename, move |
| `shell.exec` | arbitrary shell commands |

Tools that do **not** trigger snapshots: `fs.read`, `browser.*`, `canvas.*`,
`memory.*`, `search.*`.

---

## Restore workflows

Once the plugin is installed, the bundled `plakar-backup` skill teaches the
agent how to restore previous snapshots. Just ask:

> "Undo the last change" / "Roll back" / "Restore my files"

The agent will list available snapshots and offer to restore the one you choose.

### Manual restore commands

```bash
# List snapshots
plakar -s <store> ls

# Inspect a snapshot
plakar -s <store> ls <snapshot-id>

# Restore
plakar -s <store> pull <snapshot-id> <path>
```

---

## Graceful degradation

The plugin is designed to be completely transparent to the agent:

- If `plakar` is not in `$PATH` — logs a warning with install instructions, disables hooks
- If `plakar.store` is not configured — logs a warning with config instructions, disables hooks
- If a snapshot times out or fails — logs a warning, **never blocks the tool call**

---

## License

MIT
