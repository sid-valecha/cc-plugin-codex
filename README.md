# Claude Code Companion for Codex

This repository contains a Codex plugin that lets Codex use Claude Code as a local guest subprocess. The current implementation includes setup diagnostics, foreground rescue, managed background rescue jobs, structured review, and adversarial review.

## Quickstart

Run the setup check from the plugin root:

```bash
node scripts/claude-companion.mjs setup
```

For JSON output:

```bash
node scripts/claude-companion.mjs setup --json
```

The setup check is non-billable. It only runs:

- `node --version`
- `npm --version`
- `claude --version`
- `claude auth status --text`

If Claude Code is missing, install it with:

```bash
npm install -g @anthropic-ai/claude-code
claude install stable
```

If auth is missing, use `claude auth login --claudeai` for Claude subscription accounts. For strict `--bare` mode, use `claude setup-token`, `ANTHROPIC_API_KEY`, Bedrock with `CLAUDE_CODE_USE_BEDROCK=1`, Vertex with `CLAUDE_CODE_USE_VERTEX=1`, or Claude Code `apiKeyHelper`.

## Codex Skill

The initial user-facing skill is:

- `claude-setup`: diagnose local Claude Code installation and auth without sending a prompt to Claude.
- `claude-rescue`: delegate a foreground task to Claude Code through headless stream-json mode.
- `claude-status`: list active and recent background Claude jobs.
- `claude-result`: read the latest or selected Claude job result.
- `claude-cancel`: cancel a running Claude job.
- `claude-review`: run a structured, read-only Claude Code review.
- `claude-adversarial-review`: run a stricter read-only review over the same schema.
- `claude-stop-review-hook`: configure the optional Codex Stop hook review flow.

Run a foreground rescue task:

```bash
node scripts/claude-companion.mjs rescue --prompt "Inspect the failing test and suggest a fix"
```

Continue the latest resumable rescue session for the current workspace:

```bash
node scripts/claude-companion.mjs rescue --prompt "Continue from the last rescue context" --resume
```

Explicitly start a new rescue session:

```bash
node scripts/claude-companion.mjs rescue --prompt "Start this independently" --fresh
```

Start a background rescue job:

```bash
node scripts/claude-companion.mjs rescue --prompt "Inspect the failing test and suggest a fix" --background
```

Start a background job and wait for it to finish:

```bash
node scripts/claude-companion.mjs rescue --prompt "Inspect the failing test and suggest a fix" --background --wait
```

Inspect and manage jobs:

```bash
node scripts/claude-companion.mjs status
node scripts/claude-companion.mjs result --job-id <job-id>
node scripts/claude-companion.mjs cancel --job-id <job-id>
```

Rescue defaults to model `sonnet`, standard noninteractive Claude mode, permission mode `acceptEdits`, and a new Claude session for each invocation. Add `--resume` to continue the latest completed or failed rescue session in the same resolved workspace. Add `--fresh` to make the new-session choice explicit. For serious rescue or review work, prefer `--model opus`. Use `--plan` for read-only planning, `--model spark` to map to `haiku`, `--permission-mode auto` for Claude's auto permission classifier, and `--danger` only when `bypassPermissions` is explicitly intended. Use `--bare` only when you want strict isolation and have bare-compatible auth such as `claude setup-token`, `ANTHROPIC_API_KEY`, provider credentials, or `apiKeyHelper`. With `--background`, add `--wait` to keep the foreground command open until the job completes, fails, is cancelled, or reaches `--wait-timeout-ms` milliseconds. The default wait timeout is 300000ms.

Use `--effort low`, `--effort medium`, `--effort high`, `--effort xhigh`, or `--effort max` to pass Claude Code's effort setting. Use `--effort low` for smoke tests, cheap sanity checks, and explicitly low-effort requests. Claude Code may route short model aliases differently than expected; when cost matters, prefer a full Claude Code model ID and inspect the raw `modelUsage` in `--json` output. After any real Claude call, report the actual model used from `raw.modelUsage` when available.

Job state is stored under `PLUGIN_DATA`, `CODEX_PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`, or `~/.codex/plugins/data/claude-code` in that order. Use `--state-dir <path>` for tests or custom local installs.

Future worktree workflows are intentionally not implemented yet.

Human `status` and `result` output includes job id, status, Claude session id, model, effort, permission mode, isolation, exit information when relevant, model usage when Claude reports it, and useful follow-up commands. JSON output preserves existing fields and may include `modelUsage` and `nextCommands` on job objects when available.

Run a structured read-only review:

```bash
node scripts/claude-companion.mjs review
```

Review a branch diff:

```bash
node scripts/claude-companion.mjs review --base main
```

Review uses `git diff`, Claude one-shot JSON output, `--permission-mode plan`, and `schemas/review-output.schema.json`. It returns structured findings and does not edit files.

Review refuses diffs larger than 200000 bytes by default so a single accidental large diff is not sent to Claude. Narrow the diff with `--base`, split the change, or explicitly raise the limit:

```bash
node scripts/claude-companion.mjs review --base main --max-diff-bytes 500000
```

Run a stricter adversarial review with the same engine:

```bash
node scripts/claude-companion.mjs adversarial-review --base main
```

You can also use:

```bash
node scripts/claude-companion.mjs review --adversarial --base main
```

## Optional Stop Review Hook

The plugin bundles `hooks/hooks.json` with a Codex `Stop` hook. Codex requires non-managed hooks to be reviewed and trusted with `/hooks` before they run.

The hook is installed but inert by default, so trusting it does not automatically send prompts or diffs to Claude. Enable it in a shell before launching Codex:

```bash
export CLAUDE_COMPANION_STOP_REVIEW=1
```

If Codex invokes plugin-bundled hooks from a workspace other than this plugin root, also point the hook at the plugin checkout:

```bash
export CLAUDE_COMPANION_PLUGIN_ROOT=/absolute/path/to/cc-plugin-codex
```

Or enable it per repository by creating:

```bash
mkdir -p .codex
touch .codex/claude-stop-review.enabled
```

When enabled, the hook runs a read-only Claude review at turn stop using `--permission-mode plan`. By default it reports findings without blocking Codex. To make high or critical findings block the hook command, opt in explicitly:

```bash
export CLAUDE_COMPANION_STOP_REVIEW_BLOCKING=1
```

Useful hook options:

- `CLAUDE_COMPANION_STOP_REVIEW_MODEL=opus` to choose a model for serious review gates.
- `CLAUDE_COMPANION_STOP_REVIEW_EFFORT=low` to choose Claude Code effort.
- `CLAUDE_COMPANION_STOP_REVIEW_BASE=main` to review `main...HEAD` instead of uncommitted changes.
- `CLAUDE_COMPANION_STOP_REVIEW_ADVERSARIAL=1` to use the adversarial review prompt.

You can test the helper directly without installing hooks:

```bash
node scripts/claude-companion.mjs hook-stop-review --json
```

## Parity With `openai/codex-plugin-cc`

This plugin mirrors the core shape of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) in the opposite direction: Codex is the host and Claude Code is the delegated guest.

| Area | `openai/codex-plugin-cc` | Claude Code Companion | Status |
| --- | --- | --- | --- |
| Host application | Claude Code | Codex | Mirrored |
| Guest agent | Codex | Claude Code | Mirrored |
| User surface | Claude slash commands | Codex skills | Implemented using Codex-native skills |
| Setup diagnostics | `/codex:setup` | `claude-setup`, `setup` | Implemented |
| Foreground rescue | `/codex:rescue` | `claude-rescue`, `rescue` | Implemented |
| Background jobs | `--background` | `--background` | Implemented |
| Status | `/codex:status` | `claude-status`, `status` | Implemented |
| Result | `/codex:result` | `claude-result`, `result` | Implemented |
| Cancel | `/codex:cancel` | `claude-cancel`, `cancel` | Implemented |
| Structured review | `/codex:review` | `claude-review`, `review` | Implemented |
| Adversarial review | `/codex:adversarial-review` | `claude-adversarial-review`, `adversarial-review` | Implemented |
| Stop review gate | setup-managed Stop hook | optional `claude-stop-review-hook` | Implemented, inert until explicitly enabled |
| Wait mode | `--wait` | `--background --wait` | Implemented |
| Resume/fresh rescue | `--resume`, `--fresh` | `--resume`, `--fresh` | Implemented |
| Session handoff | `codex resume <session>` guidance | Claude session id is stored and `--resume` continues the latest workspace rescue session | Partially implemented |
| Install/update flow | Claude plugin marketplace install | local repo/plugin install notes only | Remaining parity work |
| Default model policy | Codex config-driven | Claude Code args plus skill guidance | Partially implemented |
| Permission learning | Deferred | Deferred allowlist idea | Remaining parity work |

Known non-parity gaps to close before release candidate:

- Add install/update and local marketplace guidance for a fresh user.
- Add troubleshooting notes for Claude auth, hook trust, sandbox/network prompts, and model alias routing.
- Design the deferred permission-learning flow for recurring Claude permission prompts and `--allowedTools`.

## Development

This project uses Node ESM and Node's built-in test runner.

```bash
npm test
```

Plugin validation can be run with the local plugin-creator validator:

```bash
python3 /Users/sidvalecha/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

Tests use a fake `claude` executable placed first on `PATH`, so they do not require a local Claude install and do not make billable calls.
