# Claude Code Companion for Codex

This repository contains a Codex plugin that lets Codex use Claude Code as a local guest subprocess. The current implementation includes setup diagnostics, foreground rescue, planning, UI/design help, managed background jobs, structured review, and permission proposal analysis.

## Quickstart

Normal use is through Codex skills. Users should ask Codex to use
`claude-setup`, `claude-rescue`, `claude-plan`, `claude-ui`, `claude-review`,
or the job-management skills instead of running the Node script by hand.

First-time local setup:

```bash
npm install -g @anthropic-ai/claude-code
claude install stable
claude auth login --claudeai
```

For unmanaged local Codex installs, create the optional approval profile once:

```bash
cat > ~/.codex/claude-companion.config.toml <<'EOF'
approval_policy = "on-request"
approvals_reviewer = "user"
sandbox_mode = "workspace-write"
EOF
codex --profile claude-companion
```

Then ask Codex:

```text
Use claude-setup to check whether Claude Code Companion is ready.
```

For actual work, use prompts like:

```text
Use claude-rescue with trusted local dev mode. Fix the failing test, run the test command, and report the result.
```

```text
Use claude-plan. Propose a migration plan for this module without editing files.
```

```text
Use claude-ui in plan mode. Review this UI and suggest concrete polish without editing files.
```

The setup check is non-billable. It only runs `node --version`,
`npm --version`, `claude --version`, and `claude auth status --text`.
Setup output also prints first-run Codex approval guidance, including the
optional `claude-companion` profile and narrow plugin command prefixes to
approve for live Claude calls.

If auth is missing, use `claude auth login --claudeai` for Claude subscription accounts. For strict `--bare` mode, use `claude setup-token`, `ANTHROPIC_API_KEY`, Bedrock with `CLAUDE_CODE_USE_BEDROCK=1`, Vertex with `CLAUDE_CODE_USE_VERTEX=1`, or Claude Code `apiKeyHelper`.

First-run live Claude calls also need host approval because they can send prompts, diffs, or workspace context to Claude Code. When Codex offers persistent approvals, approve the narrow command prefix for the mode you are using once, then future calls should not need repeated approval unless auth, policy, or host settings change. See Host Permissions below.

Raw Node commands are for development, validation, and debugging:

```bash
node scripts/claude-companion.mjs setup
node scripts/claude-companion.mjs setup --json
node scripts/claude-companion.mjs rescue --prompt "Inspect the failing test and suggest a fix"
```

### Smooth First Run

On the first real Claude call from `codex --profile claude-companion`, approve
the narrow plugin command that Codex shows, such as:

```text
node /Users/<user>/.codex/plugins/cache/personal/cc-plugin-codex/0.1.0/scripts/claude-companion.mjs rescue
```

After that, normal trusted-local development tasks can use `claude-rescue` with trusted local dev mode. If an organization forces automatic approval review and denies external Claude disclosure, the plugin cannot bypass that policy; a user or admin must allow the narrow Claude delegation prefixes for live Claude calls.

## Codex Skill

The user-facing skills are:

- `claude-setup`: diagnose local Claude Code installation and auth without sending a prompt to Claude.
- `claude-rescue`: delegate a foreground task to Claude Code through headless stream-json mode.
- `claude-plan`: ask Claude for read-only planning, architecture, migration, or debugging strategy help.
- `claude-ui`: ask Claude for frontend UI/design implementation, critique, or polish.
- `claude-status`: list active and recent background Claude jobs.
- `claude-result`: read the latest or selected Claude job result.
- `claude-cancel`: cancel a running Claude job.
- `claude-review`: run a structured, read-only Claude Code review.
- `claude-stop-review-hook`: configure the optional Codex Stop hook review flow.
- `claude-permissions`: analyze plugin-owned Claude logs for permission prompts and export reviewed `--allowedTools` arguments.

Run a foreground rescue task:

```bash
node scripts/claude-companion.mjs rescue --prompt "Inspect the failing test and suggest a fix"
```

Ask Claude for read-only planning:

```bash
node scripts/claude-companion.mjs plan --prompt "Design the migration plan for this module"
```

Ask Claude for UI/design implementation or polish:

```bash
node scripts/claude-companion.mjs ui --prompt "Polish the dashboard layout and responsive behavior"
```

Use `node scripts/claude-companion.mjs ui --prompt "<request>" --plan` for read-only UI critique.

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

Analyze permission prompts from plugin-owned job logs:

```bash
node scripts/claude-companion.mjs permissions analyze --job-id <job-id>
node scripts/claude-companion.mjs permissions show --proposal-id <proposal-id>
node scripts/claude-companion.mjs permissions export --proposal-id <proposal-id> --format allowed-tools
```

Permission proposals are written under plugin state and must be reviewed before export. The export command refuses proposals unless the proposal file has been explicitly edited to set `"approved": true`. Export prints `--allowedTools` arguments only; rescue does not consume proposals automatically.

Use `node scripts/claude-companion.mjs review --adversarial` when you want the same structured review with a stricter prompt that looks harder for subtle failure modes. The compatibility alias `adversarial-review` still exists, but `claude-review` is the main review skill.

Rescue defaults to model `sonnet`, standard noninteractive Claude mode, permission mode `acceptEdits`, and a new Claude session for each invocation. `plan` always uses read-only `plan` permission mode. `ui`/`design` use `acceptEdits` by default and switch to read-only critique with `--plan`. Add `--resume` to continue the latest completed or failed rescue session in the same resolved workspace. Add `--fresh` to make the new-session choice explicit. For serious rescue, planning, UI/design, or review work, prefer `--model opus`. Use `--plan` for read-only planning, `--model spark` to map to `haiku`, `--permission-mode auto` for Claude's auto permission classifier, and `--danger` only when `bypassPermissions` is explicitly intended. Use `--bare` only when you want strict isolation and have bare-compatible auth such as `claude setup-token`, `ANTHROPIC_API_KEY`, provider credentials, or `apiKeyHelper`. With `--background`, add `--wait` to keep the foreground command open until the job completes, fails, is cancelled, or reaches `--wait-timeout-ms` milliseconds. The default wait timeout is 300000ms.

Use `--effort low`, `--effort medium`, `--effort high`, `--effort xhigh`, or `--effort max` to pass Claude Code's effort setting. Use `--effort low` for smoke tests, cheap sanity checks, and explicitly low-effort requests. Claude Code may route short model aliases differently than expected; when cost matters, prefer a full Claude Code model ID and inspect the raw `modelUsage` in `--json` output. After any real Claude call, report the actual model used from `raw.modelUsage` when available.

### Claude Tool Permissions

Claude Code has its own tool approval layer inside the plugin invocation. Codex approval lets Codex start the plugin command; Claude approval controls what Claude Code may do after it starts, such as editing files or running tests. If Claude Code requests approval during noninteractive mode, this plugin reports `status: "permission_blocked"` instead of treating the run as successful.

For trusted local repositories, use the curated development allowlist:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --trust-local-dev
```

`--trust-local-dev` allows common local edit/search/test tools such as `Read`, `Edit`, `Write`, `Grep`, `Glob`, `LS`, `git status`, `git diff`, Python unittest, Node test, and common package-manager test commands. It is intended for normal local development, not untrusted repositories.

For narrower control, pass one or more explicit Claude Code tool patterns:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --allow-tool "Bash(python3 -m unittest*)"
```

Or read patterns from a JSON array or newline file:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --allowed-tools-file ./claude-allowed-tools.txt
```

Avoid `--danger` unless the workspace is isolated and you explicitly want Claude Code `bypassPermissions`.

Job state is stored under `PLUGIN_DATA`, `CODEX_PLUGIN_DATA`, `CLAUDE_PLUGIN_DATA`, or `~/.codex/plugins/data/claude-code` in that order. Use `--state-dir <path>` for tests or custom local installs.

The plugin does not manage Git worktrees itself; use normal Git/Codex worktree
workflows around the plugin when needed.

Human `status` and `result` output includes job id, status, Claude session id, model, effort, permission mode, isolation, exit information when relevant, model usage when Claude reports it, and useful follow-up commands. JSON output preserves existing fields and may include `modelUsage` and `nextCommands` on job objects when available.

## Local Install And Update

For development without installing the plugin, run the helper commands directly from this checkout. Codex skill files live under `skills/`, and the deterministic entry point is:

```bash
node scripts/claude-companion.mjs <subcommand>
```

For a local Codex plugin install, use a local marketplace entry that points at this plugin source. The default personal marketplace file is:

```text
~/.agents/plugins/marketplace.json
```

The default personal marketplace is discovered implicitly by Codex. Do not run `codex plugin marketplace add` for that default path. Non-default marketplace files must be added explicitly with `codex plugin marketplace add <path-to-marketplace-root>`.

A personal marketplace entry for this plugin should use the plugin name from `.codex-plugin/plugin.json` and a local source path relative to the marketplace root:

```json
{
  "name": "cc-plugin-codex",
  "source": {
    "source": "local",
    "path": "./plugins/cc-plugin-codex"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

With the default personal marketplace, that source path resolves to:

```text
~/plugins/cc-plugin-codex
```

Place this checkout there, or adjust the marketplace entry to point at the local checkout path you are actually editing. If the plugin is exposed through a non-default marketplace, confirm that the configured marketplace still points at this source before reinstalling.

After the marketplace entry exists, install or reinstall the plugin with:

```bash
codex plugin add cc-plugin-codex@personal
```

If your personal marketplace has a different top-level `name`, read it with:

```bash
python3 /Users/sidvalecha/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py
```

Then substitute the printed marketplace name:

```bash
codex plugin add cc-plugin-codex@<marketplace-name>
```

When iterating on an already-installed local plugin, update the manifest cachebuster instead of hand-editing marketplace files:

```bash
python3 /Users/sidvalecha/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py .
codex plugin add cc-plugin-codex@<marketplace-name>
```

Start a new Codex thread after reinstalling so Codex picks up updated skills, hooks, and metadata.

For repo/team distribution, use a parent marketplace root with this plugin under `plugins/cc-plugin-codex/`, then install that marketplace with `codex plugin marketplace add`. Start from `templates/team-marketplace/` or see `context/marketplace-readiness.md` for the recommended layout, Git/local install commands, and the current public-directory/MCP decision.

## Validation And Smoke Tests

Use the fake-Claude deterministic suite first. It does not require Claude auth and does not make billable calls:

```bash
npm test
node --check scripts/claude-companion.mjs
```

Plugin validation needs Python with PyYAML. A dedicated conda environment keeps that dependency out of the system Python:

```bash
conda create -y -n cc-plugin-codex-validate python=3.14 pyyaml
conda run -n cc-plugin-codex-validate python /Users/sidvalecha/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

Manual non-billable checks:

```bash
node scripts/claude-companion.mjs setup --json
node scripts/claude-companion.mjs status --limit 5
node scripts/claude-companion.mjs result
```

Real Claude smoke tests require Claude auth and may spend quota. Use low effort for cheap checks:

```bash
node scripts/claude-companion.mjs rescue --prompt "Reply with OK only" --effort low --model sonnet --json
node scripts/claude-companion.mjs rescue --prompt "Reply with OK only" --background --wait --effort low --model sonnet --json
node scripts/claude-companion.mjs review --effort low --model sonnet --json
```

Use `--model opus` only for serious validation when the cost and quota impact are acceptable.

The recommended release-candidate validation order and the next product-layer ideas are tracked in `context/next-roadmap.md`. Exact release validation commands and pass/fail criteria are tracked in `context/release-checklist.md`. Current release-candidate notes are tracked in `context/release-notes.md`.

## Host Permissions

Real Claude calls require the Codex host to allow this plugin to invoke Claude Code as an external AI subprocess. These calls can send prompts, diffs, or workspace context to Claude Code and may spend quota. Claude auth alone is not enough; host policy must also allow the call.

When Codex offers persistent command approvals, approve narrow plugin command prefixes instead of broad commands like `node`:

```text
node scripts/claude-companion.mjs rescue
node scripts/claude-companion.mjs plan
node scripts/claude-companion.mjs ui
node scripts/claude-companion.mjs design
node scripts/claude-companion.mjs review
```

Only approve the modes you want available. For example, a read-only setup can approve `plan` and `review` without approving write-capable `rescue` or `ui`. The stricter review path uses the same `review` command with `--adversarial`, so it does not need a separate first-run approval. If tenant policy blocks external disclosure, the plugin must not bypass it; local commands such as `setup`, `status`, `result`, `cancel`, and permission proposal inspection can still work.

More detail is tracked in `context/host-permissions.md`.

## Troubleshooting

Claude auth:

- `node scripts/claude-companion.mjs setup --json` should show `claudeAuth.ok: true`.
- If it reports unauthenticated, run `claude auth login --claudeai` for Claude subscription auth.
- If `claude auth status --text` works in a normal terminal but plugin setup reports unauthenticated, Codex's sandbox may not be able to read Claude's OAuth/keychain session. Approve the Claude-invoking command to run outside the sandbox, or use bare-compatible auth.
- For strict `--bare` mode, use bare-compatible auth such as `claude setup-token`, `ANTHROPIC_API_KEY`, Bedrock, Vertex, or `apiKeyHelper`.
- A rescue result like `Not logged in · Please run /login` means the plugin reached Claude Code, but Claude Code rejected the request before model execution.

Hook trust:

- The Stop hook is inert until explicitly enabled.
- Codex still requires non-managed hooks to be reviewed and trusted before they can run.
- If the hook runs from another workspace, set `CLAUDE_COMPANION_PLUGIN_ROOT=/absolute/path/to/cc-plugin-codex`.
- Enable the hook with `CLAUDE_COMPANION_STOP_REVIEW=1` or a per-repo `.codex/claude-stop-review.enabled` marker.

Sandbox and network prompts:

- `npm test` and fake-Claude tests should run without network access.
- `conda create`, dependency installation, `git push`, `gh pr create`, and real Claude calls need network access.
- Real rescue, plan, UI/design, review, and enabled Stop-hook review calls send prompts, diffs, or workspace context to Claude Code and may spend quota.
- If Codex blocks a real Claude call under external-disclosure policy, that environment cannot use the live Claude delegation commands until the user or organization allows them.
- If a Codex host or automatic approval reviewer denies the Claude delegation command, treat that as a blocked Claude run. Do not count a local Codex fallback as a successful plugin smoke test unless the user explicitly chose to proceed without Claude.
- If Claude Code blocks its own tool call during noninteractive rescue/UI work, the plugin reports `permission_blocked`. Rerun with a narrow `--allow-tool`, an approved `--allowed-tools-file`, or `--trust-local-dev` for trusted local repositories.

Model aliases and usage:

- The plugin maps `--model spark` to `haiku` and otherwise passes model strings through to Claude Code.
- Do not assume short aliases route to a specific backend model. Prefer full Claude model IDs when exact routing matters.
- After real Claude calls, inspect `modelUsage` in JSON output or stored job metadata when Claude reports it.

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
| Adversarial review | `/codex:adversarial-review` | `review --adversarial`; compatibility alias `adversarial-review` | Implemented, de-emphasized |
| Stop review gate | setup-managed Stop hook | optional `claude-stop-review-hook` | Implemented, inert until explicitly enabled |
| Wait mode | `--wait` | `--background --wait` | Implemented |
| Resume/fresh rescue | `--resume`, `--fresh` | `--resume`, `--fresh` | Implemented |
| Session handoff | `codex resume <session>` guidance | Claude session id is stored and `--resume` continues the latest workspace rescue session | Partially implemented |
| Install/update flow | Claude plugin marketplace install | local marketplace and cachebuster reinstall guidance | Documented |
| Default model policy | Codex config-driven | Claude Code args plus skill guidance | Partially implemented |
| Permission learning | Deferred | plugin-owned log analyzer with reviewed `--allowedTools` export | Implemented |

Known non-parity gaps to close before release candidate:

- None currently known.

Setup auth UX polish:

- Implemented minimal setup rendering for the documented sandbox/keychain auth visibility case. See `context/deferred-setup-auth-ux.md`.

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
