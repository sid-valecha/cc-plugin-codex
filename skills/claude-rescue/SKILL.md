---
name: claude-rescue
description: Delegate a foreground read-only or write-capable task to Claude Code from Codex using the local companion script.
---

# Claude Rescue

Use this skill when the user wants Claude Code to help with a bounded task from the current repository.

Before using rescue, confirm setup is ready:

```bash
node scripts/claude-companion.mjs setup
```

Run a foreground rescue task:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>"
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --json
```

Useful options:

- `--cwd <path>` to run Claude from a specific working directory.
- `--model <model>` to choose a Claude model. The default is `sonnet`; `spark` maps to `haiku`.
- `--write` to allow Claude Code edits with `acceptEdits`.
- `--danger` to use `bypassPermissions` only when the user explicitly accepts that risk.
- `--permission-mode <mode>` for an explicit Claude Code permission mode.
- `--session-id <uuid>` when continuing a known Claude session.

This milestone is foreground-only. Do not use `--background`, status, result, or cancel flows yet.
