# Release Notes

## 0.1.0 Release Candidate

Claude Code Companion lets Codex invoke Claude Code as a local guest subprocess
through Codex-native skills and a deterministic Node entry point.

### User-Facing Skills

- `claude-setup`: diagnose Node, npm, Claude Code, and Claude auth without
  making a billable Claude call.
- `claude-rescue`: delegate rescue/debug/fix work to Claude Code in foreground
  or managed background mode.
- `claude-plan`: ask Claude for read-only planning, architecture, migration, or
  debugging strategy.
- `claude-ui`: ask Claude for UI/design implementation, critique, or polish.
- `claude-review`: run structured read-only review over a git diff.
- `claude-status`, `claude-result`, `claude-cancel`: manage background Claude
  jobs.
- `claude-permissions`: analyze plugin-owned logs for Claude tool permission
  prompts and export reviewed `--allowedTools` arguments.
- `claude-stop-review-hook`: configure the optional inert-by-default Stop hook
  review flow.

### Implemented Capabilities

- Standard Claude Code noninteractive mode by default so Claude Pro OAuth auth
  works in normal local development.
- Opt-in `--bare` mode for strict isolation with bare-compatible auth.
- Foreground and background rescue jobs with durable plugin-owned job state.
- `--wait` for background jobs.
- `--resume` and `--fresh` rescue ergonomics.
- Rich human `status` and `result` rendering with session id, model, effort,
  permission mode, isolation, exit information, model usage, and next commands.
- Structured review and stricter `review --adversarial` mode.
- Planning and UI/design skill surfaces.
- Trusted local dev tool allowlist and explicit `--allow-tool` /
  `--allowed-tools-file` support.
- Permission-blocked Claude runs are surfaced as `permission_blocked`, not
  silent success.
- Setup recognizes `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK=1`, and
  `CLAUDE_CODE_USE_VERTEX=1` as configured environment auth.
- First-run Codex approval guidance for unmanaged local installs.
- Public Git-backed marketplace install, local/personal marketplace docs, and a
  copyable team marketplace template.
- Release checklist with deterministic validation, low-cost smoke tests, fresh
  Codex skill smoke, and serious Opus validation criteria.

### Validation Status

Completed validation is logged in `context/next-roadmap.md` under
`RC Validation Log`.

Current completed checks include:

- fake-Claude test suite
- Node syntax checks
- plugin validation using Python with PyYAML installed
- installed-cache validation
- fresh-user personal marketplace install simulation
- setup/status diagnostics
- real low-effort rescue, plan, UI plan, structured review, and
  background `rescue --wait` smokes

### Known Constraints

- Real Claude calls require Codex host approval because prompts, diffs, and
  workspace context can be sent to Claude Code and may spend quota.
- The plugin cannot bypass tenant or host policy that blocks external Claude
  disclosure.
- Claude Pro OAuth/keychain auth may be visible in a normal terminal but hidden
  from a sandboxed command process. Setup output now surfaces that case and
  points users to outside-sandbox approval or token/API/provider auth.
- Claude Code has its own tool permission layer. If Claude asks for interactive
  tool approval during noninteractive mode, the plugin reports
  `permission_blocked`.
- Public OpenAI Plugin Directory publishing should wait until public self-serve
  publishing exists. The current public install path is the Git-backed
  `marketplace` branch.

### Remaining Release Gate

- Run one serious validation task with `--model opus` after explicit approval.
- Record actual `modelUsage` in `context/next-roadmap.md`.
- Fix or log any release blockers from that pass before tagging or sharing the
  release candidate.

### Version And Tag Policy

- Keep `package.json` and `.codex-plugin/plugin.json` at `0.1.0` for this
  release-candidate line.
- After the serious Opus validation passes, create tag `v0.1.0-rc.1`.
- If RC testing stays clean, create the final stable tag `v0.1.0`.
- Do not create either tag before the Opus validation result and actual
  `modelUsage` are recorded.
