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

If setup reports unauthenticated even though `claude auth status --text` works in the user's normal terminal, the current agent sandbox may not be able to read Claude's OAuth/keychain session. Ask the user to approve the Claude-invoking command outside the sandbox, or use bare-compatible auth such as `claude setup-token`, `ANTHROPIC_API_KEY`, provider credentials, or `apiKeyHelper`.

Real rescue calls can send prompts and workspace context to Claude Code and may spend quota. If the Codex host offers persistent approvals, ask the user to approve the narrow prefix `node scripts/claude-companion.mjs rescue` instead of broad commands like `node`. If host policy blocks external disclosure, do not bypass it.

For unmanaged local Codex installs, the smooth first-run path is a one-time
Codex profile:

```bash
cat > ~/.codex/claude-companion.config.toml <<'EOF'
approval_policy = "on-request"
approvals_reviewer = "user"
sandbox_mode = "workspace-write"
EOF
codex --profile claude-companion
```

If the host approval system denies the rescue command because it would disclose
workspace context to Claude, stop and report that `claude-rescue` was blocked.
Do not silently complete the task locally with Codex, because that makes a
Claude integration smoke test look successful when Claude never ran. Only fall
back to local Codex implementation if the user explicitly asks for a local
fallback after the block is reported.

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
- `--trust-local-dev` for trusted local repositories where Claude should be allowed to edit/search and run common local test commands without a nested Claude approval stop.
- `--allow-tool <pattern>` to pass a narrow Claude Code allowed tool pattern such as `Bash(python3 -m unittest*)`. Repeat it for multiple patterns.
- `--allowed-tools-file <path>` to read approved tool patterns from a JSON array or newline file.
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

Permission guidance:

- Host/Codex approval and Claude Code tool approval are separate layers. Host denial happens before Claude runs; `permission_blocked` happens after Claude starts and requests its own tool approval.
- If host policy denies external disclosure, report the denial and the narrow command prefix to approve. Do not proceed locally unless the user explicitly asks.
- Codex approval only starts the plugin command; Claude Code can still request approval for its own tools inside the run.
- If the result status is `permission_blocked`, tell the user which tool was blocked and suggest either a narrow `--allow-tool` pattern or `--trust-local-dev` for trusted local repositories.
- Do not use `--danger` as the default fix for permission blocks.

Use `claude-status`, `claude-result`, and `claude-cancel` for managed background jobs.
