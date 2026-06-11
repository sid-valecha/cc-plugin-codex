# Claude CLI Brief

## Canonical Embed Invocation

Use this shape for streaming task delegation by default. It keeps Claude in
noninteractive print mode while allowing Claude subscription auth:

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --include-hook-events \
  --session-id <uuid> \
  --model <model> \
  --permission-mode <mode>
```

Why these flags matter:

- `-p`: noninteractive print/headless mode.
- `--input-format stream-json`: accepts newline-delimited JSON on stdin.
- `--output-format stream-json`: emits newline-delimited JSON events on stdout.
- `--include-partial-messages`: streams text deltas.
- `--include-hook-events`: exposes hook lifecycle events in the stream.

Use `--bare` only as an explicit strict-isolation option. Claude Code help says
bare mode does not read OAuth/keychain auth, so it requires bare-compatible auth
such as `claude setup-token`, `ANTHROPIC_API_KEY`, provider credentials, or
`apiKeyHelper`.

## Structured Review Invocation

Use a separate one-shot call for schema-constrained review:

```bash
claude --bare -p \
  --output-format json \
  --json-schema '<schema-json>' \
  --permission-mode plan
```

Do not combine `--json-schema` with stream-json mode. If streaming wins, schema output may be ignored.

## Permission Mapping

- read-only/review: `--permission-mode plan`
- write-capable task: `--permission-mode acceptEdits`
- dangerous full access: `--permission-mode bypassPermissions`
- approval-like default: `--permission-mode default`
- auto/no-ask mode: `--permission-mode auto`

Current plugin defaults:

- default permission mode: `acceptEdits`
- `--plan`: `plan`
- `--danger`: `bypassPermissions`

## Model Mapping

Current defaults:

- default model: `sonnet`
- `spark`: `haiku`

Preserve explicit model IDs from the user.

## Stdin Format

Claude stream-json input is newline-delimited JSON:

```json
{"type":"user","content":"prompt"}
{"type":"tool_result","tool_use_id":"<id>","content":"...","error":false}
```

For v1, user prompt input is enough. Tool result handling can be added only if tests prove it is needed for plugin-managed flows.

## Stdout Events To Handle

Handle at least:

- `system`
- `stream_event`
- `hook_event`
- `tool_use`
- `tool_result`
- message/content deltas inside wrapped stream events
- final result/message stop events

Parser rule:

- Unknown event types must not crash the run.
- Preserve raw NDJSON logs so parser gaps can be debugged later.

## Sessions And Cancellation

- Mint a UUID for new sessions.
- Avoid running two concurrent jobs with the same Claude session id.
- Persist session ids in plugin job state.
- For cancel, use OS process signals; there is no in-band JSON cancel method.
- Prefer `SIGINT`, then escalate to `SIGTERM` after a grace period.

## Setup Probes

Use non-billable checks:

```bash
claude --version
claude auth status --text
```

Auth/install hints:

- `claude auth login --claudeai`
- If `claude auth status --text` succeeds in a normal terminal but setup reports unauthenticated from the agent, the sandbox may not be able to read Claude's OAuth/keychain session; approve the Claude command outside the sandbox or use bare-compatible auth.
- `claude setup-token`
- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_USE_BEDROCK=1`
- `CLAUDE_CODE_USE_VERTEX=1`
- `apiKeyHelper`
- `npm install -g @anthropic-ai/claude-code`
- `claude install stable`

Historical planning observation on this machine:

- `claude` was found at `/opt/homebrew/bin/claude`
- version was `2.1.145`
- auth status was not logged in

Treat these as stale planning observations, not portable requirements. Current
validated versions are recorded in `context/next-roadmap.md` RC validation log.
