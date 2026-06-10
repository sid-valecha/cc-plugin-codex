# Next Roadmap

## Milestone 6 Release Candidate Order

Run release-candidate validation in this order:

1. Deterministic validation:
   - `npm test`
   - `node --check scripts/claude-companion.mjs`
   - `conda run -n cc-plugin-codex-validate python /Users/sidvalecha/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .`
   - validate the installed cache copy if the plugin has been reinstalled locally
2. Fresh local install/update smoke:
   - `codex plugin list`
   - `codex plugin add cc-plugin-codex@personal`
   - confirm the installed cache contains all skills, including `claude-permissions`
   - start a new Codex thread after reinstalling so skill metadata is reloaded
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

## Post-Milestone 5 Product Layer

Claude is especially valuable for planning and frontend/UI design. Add these as
explicit Codex skills before attempting automatic routing.

### Claude Planning

Add a `claude-plan` skill that invokes Claude in read-only planning mode.

Expected behavior:

- Use `rescue --plan`.
- Prefer `--model opus` for serious architecture/system design decisions when
  the user approves cost and quota impact.
- Produce plans, tradeoff analysis, migration strategies, debugging strategies,
  and architecture recommendations.
- Do not edit files by default.

Estimated effort: 1-2 hours with tests/docs.

### Claude UI / Design

Add a `claude-ui` or `claude-design` skill for frontend design and UI polish.

Expected behavior:

- Use a frontend/design-focused prompt scaffold.
- Allow write-capable mode when the user is asking Claude to build or polish UI.
- Use `--effort low` for cheap smoke checks and stronger model/effort settings
  for serious visual work when approved.
- Keep this explicit; do not silently route ordinary Codex frontend tasks to
  Claude.

Estimated effort: 2-4 hours with tests/docs.

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
