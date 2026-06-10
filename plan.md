# Claude Code Plugin for Codex Plan

## Goal

Build a Codex plugin that lets Codex invoke Claude Code as a guest subprocess. This is the reverse of `openai/codex-plugin-cc`: Codex is the host, Claude is the delegated agent.

The project should move in concrete, standalone milestones. Each milestone should leave the repo usable and testable, instead of waiting for a full mirror before anything works.

## Product Shape

- Codex plugin manifest: `.codex-plugin/plugin.json`
- User surface: Codex skills under `skills/`
- Deterministic glue: Node scripts under `scripts/`
- Schemas: JSON schemas under `schemas/`
- Tests: fake-Claude process tests under `test/`
- Optional lifecycle hooks: `hooks/hooks.json` in later phases

The v1 user-facing skills should be:

- `claude-setup`
- `claude-rescue`
- `claude-status`
- `claude-result`
- `claude-cancel`
- `claude-review`

Later skills:

- `claude-adversarial-review`
- optional stop-gate review skill/hook flow

## Core Architecture

Claude should be embedded through headless noninteractive mode. Default rescue to
standard noninteractive mode so Claude subscription auth works. Offer `--bare` as
an explicit strict-isolation option for API-key, provider, `setup-token`, or
`apiKeyHelper` auth:

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

Structured review should use a separate one-shot invocation:

```bash
claude --bare -p \
  --output-format json \
  --json-schema <schema> \
  --permission-mode plan
```

Important design rules:

- Do not implement Codex slash commands. Codex plugins expose reusable workflows through skills.
- Do not build a JSON-RPC client for Claude. Claude Code headless mode is newline-delimited JSON over stdin/stdout.
- Use noninteractive `-p` for every plugin-managed Claude invocation.
- Use `--bare` only when strict isolation is requested and bare-compatible auth is available.
- Maintain our own job index instead of using `~/.claude/projects` as the primary source of truth.
- Treat unknown Claude stream event types as no-ops.
- Prefer a small, tested background job runner over a broker/multiplexer in early phases.

## State Model

Use a plugin data directory resolved in this order:

1. `PLUGIN_DATA`
2. `CODEX_PLUGIN_DATA`
3. `CLAUDE_PLUGIN_DATA`
4. `~/.codex/plugins/data/claude-code`

Store:

- `jobs.json`: active and recent jobs
- `logs/<job-id>.ndjson`: raw Claude stdout events
- `logs/<job-id>.stderr.log`: Claude stderr
- `results/<job-id>.md`: final assistant-facing summary/result
- `sessions/<job-id>.json`: optional normalized session metadata

Job records should include:

- job id
- kind: `rescue`, `review`, `adversarial-review`
- status: `running`, `completed`, `failed`, `cancelled`
- cwd and workspace root
- Claude session id
- runner pid and child pid or process group
- model
- permission mode
- log/result paths
- created and updated timestamps
- exit code
- short summary

## Milestones

### Milestone 0: Scaffold

Create the installable Codex plugin skeleton.

Deliverables:

- `.codex-plugin/plugin.json`
- `skills/claude-setup/SKILL.md`
- `scripts/claude-companion.mjs`
- `package.json`
- initial `test/` structure
- `schemas/` directory
- README updated with development and install notes

Exit criteria:

- Plugin manifest validates.
- Codex can discover at least `claude-setup`.
- `npm test` exists, even if the initial suite is small.

Estimated effort: 2-4 hours.

### Milestone 0.5: Setup

Make the plugin able to diagnose Claude availability and auth.

Deliverables:

- `claude-setup` skill
- `node scripts/claude-companion.mjs setup`
- JSON and human-readable setup output

Checks:

- `node --version`
- `npm --version`
- `claude --version`
- `claude auth status --text`

Auth/install guidance should mention:

- `claude auth login`
- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_USE_BEDROCK=1` plus AWS credentials
- `CLAUDE_CODE_USE_VERTEX=1` plus GCP credentials
- `apiKeyHelper`
- `npm install -g @anthropic-ai/claude-code`
- `claude install stable`

Exit criteria:

- Missing binary, missing auth, and working auth each produce clear output.
- Setup does not make a billable Claude API call.

Estimated effort: 2-4 hours.

### Milestone 1: Rescue MVP

Add foreground Claude delegation for write-capable or read-only tasks.

Deliverables:

- `claude-rescue` skill
- `rescue` subcommand
- Claude stream parser
- model and permission option parsing
- cwd/workspace locking
- final assistant message extraction

Defaults:

- model: `sonnet`
- `spark` alias: `haiku`
- permission mode: `acceptEdits`
- `--plan`: `plan`
- `--danger`: `bypassPermissions`

Exit criteria:

- Codex can invoke Claude on a user-provided task.
- Raw stream output is handled without crashing on unknown event types.
- Foreground mode returns a usable result to Codex.

Estimated effort: 0.5-1 day.

### Milestone 1.5: Managed Jobs

Turn rescue into a practical long-running delegation workflow.

Deliverables:

- background runner mode
- durable job index
- `claude-status`
- `claude-result`
- `claude-cancel`
- stdout/stderr/result log files
- cancellation by PID or process group

Cancellation behavior:

- Prefer graceful termination.
- Send `SIGINT` first.
- Escalate to `SIGTERM` after a short grace period.
- Mark the job `cancelled` only after the process exits or is confirmed gone.

Exit criteria:

- Start a background rescue job.
- List active/recent jobs.
- Fetch the latest or selected result.
- Cancel a running job safely.
- Survive stale PID records.

Estimated effort: 1-2 days.

### Milestone 2: Structured Review

Add the first read-only review path.

Deliverables:

- `claude-review` skill
- `review` subcommand
- `schemas/review-output.schema.json`
- git diff collection
- structured review prompt
- JSON schema parsing and validation

Review behavior:

- Default to uncommitted changes.
- Support `--base <ref>` for branch diff review.
- Use `--permission-mode plan`.
- Use one-shot JSON output, not stream-json.
- Inspect `structured_output`; treat null as schema failure.

Exit criteria:

- Produces parseable findings from a fake-Claude fixture.
- Handles empty diffs clearly.
- Handles schema failure clearly.
- Does not mutate files.

Estimated effort: 0.5-1 day.

### Milestone 2.5: Hardening

Make the core reliable enough to continue building on.

Deliverables:

- fake `claude` executable test harness
- stream parser unit tests
- setup tests
- job lifecycle tests
- cancellation tests
- review parsing tests
- oversized input handling

Edge cases:

- malformed NDJSON line
- unknown event type
- partial JSON input deltas
- auth failure
- Claude crash
- null structured output
- stale PID
- cwd deleted or moved
- piped input over Claude's practical limit

Exit criteria:

- `npm test` covers the main process and parser behavior.
- Failures produce actionable stderr/result messages.

Estimated effort: 1-2 days.

### Milestone 3: Adversarial Review

Add a stricter review mode using the same review engine.

Deliverables:

- `claude-adversarial-review` skill
- adversarial prompt template
- separate result labeling

Exit criteria:

- Reuses the structured review implementation.
- Does not duplicate schema or diff collection logic.

Estimated effort: 2-4 hours.

### Milestone 4: Hook Integration

Add optional lifecycle hook support.

Deliverables:

- `hooks/hooks.json`
- hook helper script
- documented trust/enable flow
- stop-gate review behavior

Constraints:

- Keep this optional.
- Do not make first-run hook trust a blocker for the core plugin.
- Keep hook behavior conservative and read-only.

Exit criteria:

- Hook can run in a trusted local install.
- Hook failure does not corrupt job state.
- User can disable or ignore hooks and still use the core skills.

Estimated effort: 0.5-1.5 days.

### Milestone 5: Full Mirror Polish

Close the major gaps with the original plugin.

Deliverables:

- improved docs and examples
- resume guidance
- richer status/result rendering
- marketplace metadata
- install/update flow
- parity matrix against `openai/codex-plugin-cc`
- deferred permission-learning flow that analyzes recurring Claude permission prompts or command history, proposes an allowlist file for user review, and feeds approved patterns into Claude through settings or `--allowedTools`

Explicit non-goals unless evidence changes:

- broker/multiplexer
- primary transcript listing from `~/.claude/projects`
- non-bare embedding
- exact Claude Code UI parity

Exit criteria:

- New user can install, run setup, launch rescue, inspect status/result, cancel, and run review from a fresh Codex thread.
- Known non-parity gaps are documented.

Estimated effort: 1-2 days.

### Milestone 6: Release Candidate

Stabilize and validate the plugin for normal use.

Deliverables:

- full test run
- plugin validation
- local install smoke test
- README quickstart
- troubleshooting guide
- final issue list for deferred parity work
- final issue list for deferred setup UX polish, including sandbox/keychain auth visibility

Smoke tests:

- setup with current local Claude install
- setup with fake missing Claude
- rescue foreground
- rescue background
- status
- result
- cancel
- review

Exit criteria:

- The repo can be handed to another user or agent with clear install and development instructions.

Estimated effort: 1 day.

## Worktree Strategy

Use worktrees when parallel implementation starts. The repo is small now, so worktrees are most useful after Milestone 0 creates the basic structure.

Recommended branches:

- `main`: stable, only milestone-complete merges
- `feat/scaffold-setup`: Milestone 0 and 0.5
- `feat/rescue-jobs`: Milestone 1 and 1.5
- `feat/review`: Milestone 2 and 3
- `feat/hooks`: Milestone 4

Avoid parallel edits to shared script internals until the interfaces are stable. In practice, complete scaffold/setup first, then split rescue/jobs and review.

## Subagent Strategy

Use subagents only after the scaffold exists. Before that, the repo is too empty and parallel work would mostly create conflicts.

Good subagent assignments:

- Claude CLI research and fixture authoring
- stream parser tests
- review schema/prompt design
- README/troubleshooting docs
- parity matrix against `openai/codex-plugin-cc`

Keep one lead agent responsible for:

- script interfaces
- state schema
- merge order
- final validation

## Fresh Chat Handoff

For a new Codex chat, attach or point the agent at:

- `plan.md`
- `context/agent-instructions.md`
- `context/implementation-brief.md`
- `context/claude-cli-brief.md`

Suggested fresh-chat prompt:

```text
We are building a Codex plugin that invokes Claude Code as a subprocess. Read plan.md and the context/ folder first. Implement the next incomplete milestone only, preserving the milestone boundaries and tests. Do not skip ahead unless the milestone exit criteria are satisfied.
```

## Current Known Local Environment

Observed during planning:

- repo initially contained only `README.md`, `LICENSE`, and `.gitignore`
- `claude` resolved to `/opt/homebrew/bin/claude`
- Claude Code version was `2.1.145`
- Node version was `v25.6.0`
- npm version was `11.8.0`
- `claude auth status --text` reported not logged in

Treat these as planning observations, not portable requirements.
