# Next Roadmap

## Milestone 6 Release Candidate Order

Run release-candidate validation in this order:

Detailed commands and pass/fail criteria are tracked in
`context/release-checklist.md`.

1. Deterministic validation:
   - `npm test`
   - `node --check scripts/claude-companion.mjs`
   - `python "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/validate_plugin.py" .`
   - validate the installed cache copy if the plugin has been reinstalled locally
2. Fresh local install/update smoke:
   - `codex plugin list`
   - `codex plugin add cc-plugin-codex@personal`
   - confirm the installed cache contains all skills, including `claude-permissions`
   - start a new Codex thread after reinstalling so skill metadata is reloaded
   - for repo/team distribution, follow `context/marketplace-readiness.md`
     instead of assuming this plugin repo is also the marketplace root
3. Non-billable real environment checks:
   - `node scripts/claude-companion.mjs setup --json`
   - `node scripts/claude-companion.mjs status --limit 5`
   - confirm the documented sandbox/keychain auth behavior still matches reality
4. Low-cost real Claude smoke tests, only after explicit user approval:
   - foreground rescue with `--effort low`
   - background rescue with `--background --wait --effort low`
   - tiny structured review with `--effort low`
5. Serious validation, only after explicit user approval:
   - use `--model opus`
   - run one meaningful rescue or review task
   - report actual `modelUsage` from JSON output or stored job metadata

## RC Validation Log

- 2026-06-12: Tiny model-routing smoke tests passed after explicit user
  approval, using `rescue --plan --effort low --json` and prompts that asked
  Claude to reply exactly `OK` without inspecting or modifying files.
  - `--model sonnet` returned `OK` and reported actual usage as
    `claude-sonnet-4-6`; reported cost was `$0.08939775`.
  - `--model opus` returned `OK` and reported actual usage as
    `claude-opus-4-7`; reported cost was `$0.22387375`.
  - `--model haiku` returned `OK`; Claude Code initialized the session model
    as `claude-haiku-4-5-20251001`, but the assistant message and
    `modelUsage` reported `claude-sonnet-4-6`. Treat Haiku as requested, not
    guaranteed, for Claude Code agent runs.
- 2026-06-11: Serious Opus structured review validation passed against a
  throwaway git fixture at
  `/private/tmp/cc-plugin-codex-opus-review.mJOMK1`.
  - Created and committed a passing Python calculator baseline, then seeded a
    one-line bug changing `divide()` from `b == 0` to `b == "0"`.
  - `python3 -m unittest -v` failed as expected before review with
    `ZeroDivisionError` for `divide(1, 0)`.
  - Command used `review --model opus --json` through
    `scripts/claude-companion.mjs`.
  - Claude returned a high-severity finding on `calculator.py:17`, correctly
    identifying that the divide-by-zero guard no longer catches numeric zero.
  - Claude also returned a medium test-coverage finding; this was not fully
    grounded because the fixture did include a failing divide-by-zero test, but
    the primary seeded regression was identified correctly.
  - Session id: `e38627e4-4c79-40f6-9afc-65ca6a9eb7e4`.
  - Actual model usage reported `claude-opus-4-7`; reported cost was
    `$0.4909675`.
- 2026-06-10: Fresh Codex-thread `claude-rescue` smoke passed against the
  throwaway Python calculator fixture at
  `/private/tmp/cc-plugin-codex-smoke-python-calc`.
  - Launched Codex with `--profile claude-companion`.
  - Codex selected `cc-plugin-codex:claude-rescue`.
  - The plugin cache script was invoked with `--trust-local-dev`.
  - Codex host approval allowed the external Claude disclosure.
  - Claude edited `calculator.py` so `power(a, b)` returns `a ** b`.
  - Claude ran Python unittest verification; Codex also verified locally with
    `python3 -m unittest -v`.
  - Actual model usage reported `claude-sonnet-4-6`.
- 2026-06-10: Direct plugin-cache `claude-plan` smoke passed against the same
  calculator fixture.
  - Command used `plan --effort low --model sonnet --json`.
  - The run completed with `permissionMode: "plan"` and session id
    `f1a31ec0-cbac-42b9-b121-6d0e370e7600`.
  - Fixture files were inspected after the run and remained unchanged.
  - Claude plan mode created its normal plan artifact under `~/.claude/plans`.
  - Actual model usage reported `claude-sonnet-4-6`.
- 2026-06-10: Direct plugin-cache `claude-ui --plan` smoke passed against the
  same calculator fixture.
  - Command used `ui --plan --effort low --model sonnet --json`.
  - The run completed with `permissionMode: "plan"` and session id
    `b13d6846-e6b8-47f5-bf56-c23af1c722c8`.
  - Claude returned a concise readability suggestion without editing files.
  - Actual model usage reported `claude-sonnet-4-6`.
- 2026-06-10: Direct plugin-cache `claude-review` smoke passed against a
  throwaway git fixture at
  `/private/tmp/cc-plugin-codex-review-smoke.7Tp7Ah`.
  - Seeded diff changed `divide()` from `b == 0` to `b == "0"`.
  - `python -m unittest -v` failed as expected before review.
  - Command used `review --effort low --model sonnet --json`.
  - Claude returned one critical finding on `calculator.py:17`, correctly
    identifying the broken division-by-zero guard.
  - Actual model usage reported `claude-sonnet-4-6`.
- 2026-06-10: Deterministic RC validation passed on `main`.
  - `npm test` passed with 53 tests.
  - `node --check scripts/claude-companion.mjs` passed.
  - Plugin validation passed for both the repository checkout and installed
    cache copy using Python with PyYAML installed.
- 2026-06-10: Non-billable installed-cache runtime checks passed.
  - `setup --json` saw Node v26.3.0, npm 11.16.0, Claude Code 2.1.153,
    and authenticated Claude Pro account status outside the sandbox.
  - `setup --json` emitted first-run approval guidance for the
    `claude-companion` Codex profile and narrow plugin command prefixes.
  - `status --limit 5` rendered rich completed-job metadata, including
    session id, model/effort/permission/isolation, exit code, model usage, and
    next result command.
- 2026-06-10: Direct plugin-cache background `rescue --wait` smoke passed
  against the calculator fixture.
  - Command used `rescue --background --wait --wait-timeout-ms 120000
    --permission-mode plan --effort low --model sonnet --json`.
  - The run completed with job id `rescue-1781137629537-c364c0f9`, session id
    `2d0ff4c8-de33-4d19-9f83-d3fdb62097f2`, and result `OK`.
  - Human `result` and `status` output included session id, model, effort,
    permission mode, isolation, exit code, actual model usage, and next
    commands.
  - Actual model usage reported `claude-sonnet-4-6`.
- 2026-06-11: Fresh-user install simulation passed without real Claude calls.
  - `codex plugin list` showed `cc-plugin-codex@personal` installed and
    enabled from the local personal marketplace checkout.
  - `codex plugin add cc-plugin-codex@personal` reinstalled the plugin into
    the personal Codex plugin cache.
  - Installed-cache plugin validation passed using Python with PyYAML installed.
  - Installed-cache `scripts/claude-companion.mjs` passed `node --check`.
  - Installed-cache skills included setup, rescue, plan, UI, review,
    adversarial-review, permissions, status, result, cancel, and Stop hook.
  - Installed-cache team marketplace template was present and its
    `marketplace.json` parsed successfully.
  - Installed-cache `setup --json` reported Node v26.3.0, npm 11.16.0,
    Claude Code 2.1.153, and authenticated Claude Pro account status outside
    the sandbox.
  - Installed-cache `status --limit 5` rendered existing completed jobs with
    session ids, model usage, and next result commands.
- 2026-06-11: Team marketplace dry run passed without real Claude calls.
  - Prepared a temp marketplace root under
    `/private/tmp/cc-plugin-codex-team-marketplace-smoke.*` from
    `templates/team-marketplace/`.
  - Copied the plugin into `plugins/cc-plugin-codex` with Git metadata
    excluded.
  - Temp marketplace `marketplace.json` parsed successfully.
  - Copied plugin validation passed using Python with PyYAML installed.
  - `codex plugin marketplace add <temp-root>` registered marketplace
    `team-codex`.
  - `codex plugin add cc-plugin-codex@team-codex` installed the plugin into
    the team marketplace Codex plugin cache.
  - Team-cache plugin validation and `node --check` passed.
  - Team-cache `setup --json` and `status --limit 2` passed.
  - Removed the temporary `cc-plugin-codex@team-codex` install and
    `team-codex` marketplace registration after the dry run; the personal
    marketplace install remained enabled.

## Post-Milestone 5 Product Layer

Claude is especially valuable for planning and frontend/UI design. Add these as
explicit Codex skills before attempting automatic routing.

### Claude Planning

Implemented as `claude-plan` and the `plan` subcommand.

Expected behavior:

- Use `rescue --plan`.
- Prefer `--model opus` for serious architecture/system design decisions when
  the user approves cost and quota impact.
- Produce plans, tradeoff analysis, migration strategies, debugging strategies,
  and architecture recommendations.
- Do not edit files by default.

Implemented with fake-Claude tests/docs.

### Claude UI / Design

Implemented as `claude-ui` plus `ui` and `design` subcommands.

Expected behavior:

- Use a frontend/design-focused prompt scaffold.
- Allow write-capable mode when the user is asking Claude to build or polish UI.
- Use `--effort low` for cheap smoke checks and stronger model/effort settings
  for serious visual work when approved.
- Keep this explicit; do not silently route ordinary Codex frontend tasks to
  Claude.

Implemented with fake-Claude tests/docs.

### Claude Skill / Plugin Bridging

Investigate explicit bridging to Claude Code's own skills/plugins after the
planning and UI skills are stable.

Claude Code help exposes:

- `--plugin-dir <path>`
- `--agents <json>`
- `--agent <agent>`
- slash-skill resolution unless slash commands are disabled
- in `--bare`, skills can still resolve by name, but plugins/autodiscovery are
  reduced unless context is passed explicitly

Potential implementation:

- Add pass-through options such as `--plugin-dir <path>`, `--agent <name>`, and
  `--claude-skill <name>`.
- Keep invocation explicit and auditable.
- Test noninteractive `-p` behavior with a fake or local Claude plugin before
  relying on it.
- Do not make skill routing automatic until the explicit path is reliable.

Estimated effort: 0.5-1 day for investigation and a minimal explicit bridge.

## Marketplace Readiness

Current recommendation is documented in `context/marketplace-readiness.md`:

- use the public Git-backed `marketplace` branch for normal OSS installs
- keep personal/local marketplace installs for development and release-candidate
  validation
- use a parent repo/team marketplace root for CLI/dev distribution
- use workspace sharing for selected teammates in the Codex app
- wait on the public OpenAI Plugin Directory until public self-serve publishing
  is available and the plugin is release-candidate stable
- do not add MCP just to invoke Claude Code; revisit MCP only for structured
  tools, persistent services, shared state, or integrations such as Figma/browser
  tooling
