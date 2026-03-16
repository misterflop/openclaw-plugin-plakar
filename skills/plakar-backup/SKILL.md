---
slug: plakar-backup
name: Plakar Restore Workflows
tags:
  - backup
  - filesystem
  - resilience
description: >
  Teaches the agent how to list, inspect, and restore Plakar snapshots.
  Invoke when the user says "undo", "rollback", "restore", or "revert".
---

# Plakar Restore Workflows

This skill covers **restore operations only**. Triggering snapshots is handled
automatically by the openclaw-plugin-plakar plugin — you do not need to call
`plakar push` manually.

## When to offer restore

Offer to restore from a Plakar snapshot when the user says anything like:
- "undo that", "roll back", "revert to before", "restore my files"
- "something went wrong, can we go back"
- "the last tool call broke things"

## Prerequisites

- `plakar` must be in `$PATH`
- The store path is available in plugin config as `plakar.store`

Retrieve the store path before running any command:
```
store = <value of plakar.store config>
```

## List available snapshots

```bash
plakar -s <store> ls
```

Output includes snapshot IDs, timestamps, and paths. Present the list to the
user and ask which snapshot to restore.

## Inspect a snapshot

```bash
plakar -s <store> ls <snapshot-id>
```

Shows the file tree inside a specific snapshot. Useful to confirm it contains
the expected state before restoring.

## Restore a specific snapshot

```bash
plakar -s <store> pull <snapshot-id> <path>
```

- `<path>` is the directory or file to restore (e.g. `/workspace` or `/workspace/src/app.ts`)
- Restores files in-place; existing files are overwritten

**Always confirm with the user** before running a restore — it overwrites live files.

## Diff two snapshots (if supported)

```bash
plakar -s <store> diff <snapshot-id-1> <snapshot-id-2>
```

Use this to show the user what changed between two points in time before
deciding which snapshot to restore.

## Example agent interaction

> User: "The last edit broke my config file, can you undo it?"

1. Run `plakar -s <store> ls` and show the user the most recent snapshots
2. Ask: "Should I restore from snapshot `<id>` taken at `<timestamp>`?"
3. On confirmation: run `plakar -s <store> pull <id> <path>`
4. Confirm the restore completed and invite the user to verify the file
