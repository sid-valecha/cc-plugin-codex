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

Run a background rescue task:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --background
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --json
```

Useful options:

- `--cwd <path>` to run Claude from a specific working directory.
- `--model <model>` to choose a Claude model. The default is `sonnet`; `spark` maps to `haiku`.
- `--plan` to use read-only `plan` permission mode.
- `--write` to force Claude Code edits with `acceptEdits`, which is also the default for rescue.
- `--permission-mode auto` to use Claude Code's automatic permission classifier.
- `--danger` to use `bypassPermissions` only when the user explicitly accepts that risk.
- `--permission-mode <mode>` for an explicit Claude Code permission mode.
- `--session-id <uuid>` when continuing a known Claude session.
- `--bare` for strict isolation when using `claude setup-token`, `ANTHROPIC_API_KEY`, Bedrock, Vertex, or `apiKeyHelper`.
- `--state-dir <path>` for tests or custom plugin data locations.

Use `claude-status`, `claude-result`, and `claude-cancel` for managed background jobs.
