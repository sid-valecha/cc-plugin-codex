# Implementation Brief

## What We Are Building

The upstream `openai/codex-plugin-cc` lets Claude Code invoke Codex. This project inverts that relationship: Codex invokes Claude Code.

Codex host:

- plugin manifest: `.codex-plugin/plugin.json`
- user surface: `skills/<skill>/SKILL.md`
- helper scripts: `scripts/*.mjs`
- optional hooks: `hooks/hooks.json`

Claude guest:

- invoked as a subprocess
- controlled through stdin/stdout
- emits newline-delimited JSON in stream-json mode
- persists sessions by Claude session id

## Plugin Skills

- `claude-setup`: diagnose local Claude installation and auth
- `claude-rescue`: delegate a task to Claude
- `claude-plan`: request read-only planning, architecture, migration, or debugging strategy
- `claude-ui`: request UI/design implementation, critique, or polish
- `claude-status`: list active/recent Claude jobs
- `claude-result`: show result for latest or selected job
- `claude-cancel`: cancel a running Claude job
- `claude-review`: run structured read-only review
- `claude-adversarial-review`: compatibility alias for stricter review; prefer `claude-review` with `--adversarial`
- `claude-permissions`: analyze plugin-owned logs for permission prompts and export reviewed `--allowedTools`
- `claude-stop-review-hook`: configure the optional inert-by-default Stop hook review flow

## Script Interface

Expected main command:

```bash
node scripts/claude-companion.mjs <subcommand> [options]
```

Current subcommands:

- `setup`
- `rescue`
- `plan`
- `ui`
- `design`
- `status`
- `result`
- `cancel`
- `review`
- `adversarial-review`
- `permissions`

Useful global options:

- `--json`
- `--cwd <path>`
- `--state-dir <path>`
- `--model <model>`

Rescue options:

- `--prompt <text>`
- `--background`
- `--wait`
- `--wait-timeout-ms <n>`
- `--write`
- `--danger`
- `--plan`
- `--session-id <uuid>`
- `--resume`
- `--fresh`
- `--effort <level>`
- `--bare`
- `--trust-local-dev`
- `--allow-tool <pattern>`
- `--allowed-tools-file <path>`

Review options:

- `--base <ref>`
- `--schema <path>`

## State Directory Resolution

Resolve state directory in this order:

1. `PLUGIN_DATA`
2. `CODEX_PLUGIN_DATA`
3. `CLAUDE_PLUGIN_DATA`
4. `~/.codex/plugins/data/claude-code`

The fallback is a pragmatic default. If official plugin data environment variables are discovered later, update this resolution centrally.

## Testing Approach

Use a fake `claude` executable in tests. Put it first on `PATH` and make it emit controlled stdout/stderr/exit codes.

Test high-risk behavior before real Claude calls:

- setup with binary present/missing
- auth success/failure
- stream-json parsing
- malformed NDJSON
- unknown events
- cancellation
- stale job records
- structured review output
- null `structured_output`
