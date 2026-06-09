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

## Initial Plugin Skills

- `claude-setup`: diagnose local Claude installation and auth
- `claude-rescue`: delegate a task to Claude
- `claude-status`: list active/recent Claude jobs
- `claude-result`: show result for latest or selected job
- `claude-cancel`: cancel a running Claude job
- `claude-review`: run structured read-only review

## Script Interface

Expected main command:

```bash
node scripts/claude-companion.mjs <subcommand> [options]
```

Initial subcommands:

- `setup`
- `rescue`
- `status`
- `result`
- `cancel`
- `review`

Useful global options:

- `--json`
- `--cwd <path>`
- `--state-dir <path>`
- `--model <model>`

Rescue options:

- `--prompt <text>`
- `--background`
- `--write`
- `--danger`
- `--session-id <uuid>`

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
