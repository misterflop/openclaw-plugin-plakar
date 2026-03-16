---
name: plakar-snapshot
description: >
  Captures a Plakar snapshot of the workspace before and after every
  filesystem-mutating or shell-executing tool call. Snapshots are
  non-blocking: failures are logged as warnings and never interrupt the agent.
events:
  - before_tool_call
  - after_tool_call
requires:
  bins:
    - plakar
---

## Eligibility

This hook runs only when **all** of the following are true:

- `plakar` is present in `$PATH`
- `plakar.store` is set in plugin config
- The tool name matches one of the trigger prefixes:
  - `fs.write`
  - `fs.delete`
  - `fs.move`
  - `shell.exec`

Tools that do **not** trigger snapshots: `fs.read`, `browser.*`, `canvas.*`,
`memory.*`, `search.*`.

## Failure behaviour

If `plakar push` exits non-zero or times out, the hook logs a warning and
returns normally. The tool call is never blocked.
