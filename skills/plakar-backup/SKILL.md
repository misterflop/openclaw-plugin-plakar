---
slug: plakar-backup
name: Plakar Backup
tags:
  - backup
  - filesystem
  - resilience
description: >
  Plakar backup and restore workflows. Use when the user asks about Plakar
  snapshots, where backups are stored, how to list or restore snapshots, or
  says "undo", "rollback", "restore", or "revert".
---

# Plakar Restore Workflows

This skill covers **restore operations only**. Triggering snapshots is handled
automatically by the openclaw-plugin-plakar plugin — you do not need to run
`plakar backup` manually.

## When to use this skill

Use this skill when the user asks about:
- Where Plakar backups/snapshots are stored ("où sont les sauvegardes", "where are backups")
- Listing or browsing snapshots
- Restoring, undoing, rolling back: "undo that", "roll back", "revert to before", "restore my files"
- "something went wrong, can we go back", "the last tool call broke things"

## Prerequisites

- `plakar` must be in `$PATH`
- Always pass `-no-agent` to avoid requiring a running plakar agent daemon

## Finding the store location

**Always resolve the store location before running any plakar command:**

```bash
openclaw config get plugins.entries.openclaw-plugin-plakar.config.location
```

This prints the configured store location (e.g. `/plakar-store` or `s3://bucket/prefix`).
Use that value as `<store>` in every command below.

If the command returns nothing, check the legacy key:
```bash
openclaw config get plugins.entries.openclaw-plugin-plakar.config.store
```

If both return nothing, the plugin is not configured — tell the user to run:
```bash
openclaw config set plugins.entries.openclaw-plugin-plakar.config.location <path>
```

## Named store

The plugin registers a named store called `@openclaw-backup` at startup using:
```bash
plakar -no-agent store add openclaw-backup <location> [s3 options...]
```

You can use `@openclaw-backup` directly in all commands instead of the full path:
```bash
plakar -no-agent at @openclaw-backup ls
```

## CLI syntax (v1.0.6+)

All commands use the form:
```
plakar -no-agent at <store> <command> [options]
```

Where `<store>` is either `@openclaw-backup` or the full location path.

## List all snapshots

```bash
plakar -no-agent at @openclaw-backup ls
```

Output: snapshot ID, timestamp, size, path. Present the list to the user and
ask which snapshot to restore from.

## Inspect a snapshot's contents

```bash
plakar -no-agent at @openclaw-backup ls <snapshotID>
plakar -no-agent at @openclaw-backup ls -recursive <snapshotID>:/path
```

Use this to confirm the snapshot contains the expected state before restoring.

## Diff two snapshots

```bash
plakar -no-agent at @openclaw-backup diff <snapshotID1> <snapshotID2>
plakar -no-agent at @openclaw-backup diff -highlight <snapshotID1>:/file <snapshotID2>:/file
```

Use this to show the user what changed between two points in time.

## Restore a snapshot

Restore all files to the original paths:
```bash
plakar -no-agent at @openclaw-backup restore <snapshotID>
```

Restore to a specific directory:
```bash
plakar -no-agent at @openclaw-backup restore -to /tmp/restore-here <snapshotID>
```

Restore a specific path within a snapshot:
```bash
plakar -no-agent at @openclaw-backup restore -to /tmp/restore-here <snapshotID>:/path/to/file
```

**Always confirm with the user** before running a restore — it overwrites live files.

## Plugin configuration reference

| Config key      | Description                                      | Required |
|-----------------|--------------------------------------------------|----------|
| `location`      | Store path or URL (`/path` or `s3://bucket/pfx`) | Yes      |
| `passphrase`    | Encryption passphrase (sensitive)                | No       |
| `s3AccessKey`   | S3 / MinIO access key                            | S3 only  |
| `s3SecretKey`   | S3 / MinIO secret key (sensitive)                | S3 only  |
| `s3UseTls`      | Enable TLS for S3 connections (default: true)    | No       |
| `s3StorageClass`| S3 storage class (e.g. STANDARD, GLACIER)        | No       |
| `paths`         | Paths to snapshot (default: workspace dir)       | No       |
| `timeout`       | Snapshot timeout in ms (default: 15000)          | No       |

## Example agent interaction

> User: "The last edit broke my config file, can you undo it?"

1. Run `plakar -no-agent at @openclaw-backup ls` and show the most recent snapshots
2. Ask: "Should I restore from snapshot `<id>` taken at `<timestamp>`?"
3. On confirmation: `plakar -no-agent at @openclaw-backup restore -to <original-path> <id>`
4. Confirm the restore completed and invite the user to verify the file
