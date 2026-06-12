---
name: claude-stop-review-hook
description: Configure or explain the optional Codex Stop hook that can run a read-only Claude review when a turn ends.
---

# Claude Stop Review Hook

Use this skill when the user wants Claude Code to review changes automatically when a Codex turn stops.

The plugin bundles `hooks/hooks.json` with a `Stop` hook, but the hook helper is inert until explicitly configured with the plugin root and then enabled for review. Codex also requires non-managed hooks to be reviewed and trusted with `/hooks` before they run.

First point the bundled hook config at this plugin using an absolute path before launching Codex:

```bash
export CLAUDE_COMPANION_PLUGIN_ROOT=/absolute/path/to/cc-plugin-codex
```

Then enable review in the shell before launching Codex:

```bash
export CLAUDE_COMPANION_STOP_REVIEW=1
```

Or enable it per repository:

```bash
mkdir -p .codex
touch .codex/claude-stop-review.enabled
```

The per-repository marker enables review after the hook helper is located; it does not replace `CLAUDE_COMPANION_PLUGIN_ROOT`.

By default, the hook reports review findings without blocking Codex. To block on high or critical findings:

```bash
export CLAUDE_COMPANION_STOP_REVIEW_BLOCKING=1
```

Useful options:

- `CLAUDE_COMPANION_STOP_REVIEW_MODEL=opus` to choose the model for serious review gates.
- `CLAUDE_COMPANION_STOP_REVIEW_EFFORT=low` to choose Claude Code effort.
- `CLAUDE_COMPANION_STOP_REVIEW_BASE=main` to review `main...HEAD`.
- `CLAUDE_COMPANION_STOP_REVIEW_ADVERSARIAL=1` to use the adversarial review prompt.

Model guidance:

- Use `CLAUDE_COMPANION_STOP_REVIEW_MODEL=opus` for serious blocking gates or important merge-readiness checks.
- Use `CLAUDE_COMPANION_STOP_REVIEW_EFFORT=low` only for smoke tests, cheap sanity checks, or explicitly low-effort requests.
- Do not assume short aliases always map to the expected backend model. After real Claude calls, inspect and report actual model usage from JSON output when available.

Manual smoke test:

Use the companion script from the installed plugin root. If the current working
directory is not this plugin checkout, resolve the script relative to this skill
file, for example `../../scripts/claude-companion.mjs`.

```bash
node scripts/claude-companion.mjs hook-stop-review --json
```

The hook always uses Claude Code `--permission-mode plan` and should not edit files.
