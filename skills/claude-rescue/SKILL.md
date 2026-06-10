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

Continue the latest resumable rescue session for the current workspace:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --resume
```

Explicitly start a new rescue session:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --fresh
```

Run a background rescue task:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --background
```

Start a background rescue task and wait for completion:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --background --wait
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --json
```

Useful options:

- `--cwd <path>` to run Claude from a specific working directory.
- `--model <model>` to choose a Claude model. The default is `sonnet`; `spark` maps to `haiku`.
- `--effort <level>` to pass Claude Code effort: `low`, `medium`, `high`, `xhigh`, or `max`.
- `--plan` to use read-only `plan` permission mode.
- `--write` to force Claude Code edits with `acceptEdits`, which is also the default for rescue.
- `--permission-mode auto` to use Claude Code's automatic permission classifier.
- `--danger` to use `bypassPermissions` only when the user explicitly accepts that risk.
- `--permission-mode <mode>` for an explicit Claude Code permission mode.
- `--session-id <uuid>` when continuing a known Claude session.
- `--resume` to continue the latest completed or failed rescue session for the same resolved workspace.
- `--fresh` to explicitly force a new Claude session, which is also the default behavior.
- `--wait` with `--background` to wait until the job completes, fails, is cancelled, or times out.
- `--wait-timeout-ms <n>` to choose the wait timeout. The default is 300000.
- `--bare` for strict isolation when using `claude setup-token`, `ANTHROPIC_API_KEY`, Bedrock, Vertex, or `apiKeyHelper`.
- `--state-dir <path>` for tests or custom plugin data locations.

Model guidance:

- Use `--model opus` for serious rescue work, hard debugging, important edits, or decisions that need high confidence.
- Use `--effort low` for smoke tests, cheap sanity checks, or explicitly low-effort requests.
- Do not assume short aliases always map to the expected backend model. After real Claude calls, inspect and report actual model usage from JSON output when available.

Use `claude-status`, `claude-result`, and `claude-cancel` for managed background jobs.
