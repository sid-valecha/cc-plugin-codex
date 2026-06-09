---
name: claude-stop-review-hook
description: Configure or explain the optional Codex Stop hook that can run a read-only Claude review when a turn ends.
---

# Claude Stop Review Hook

Use this skill when the user wants Claude Code to review changes automatically when a Codex turn stops.

The plugin bundles `hooks/hooks.json` with a `Stop` hook, but the hook helper is inert until explicitly enabled. Codex also requires non-managed hooks to be reviewed and trusted with `/hooks` before they run.

Enable the hook in the shell before launching Codex:

```bash
export CLAUDE_COMPANION_STOP_REVIEW=1
```

Or enable it per repository:

```bash
mkdir -p .codex
touch .codex/claude-stop-review.enabled
```

By default, the hook reports review findings without blocking Codex. To block on high or critical findings:

```bash
export CLAUDE_COMPANION_STOP_REVIEW_BLOCKING=1
```

Useful options:

- `CLAUDE_COMPANION_STOP_REVIEW_MODEL=haiku` to choose a model.
- `CLAUDE_COMPANION_STOP_REVIEW_BASE=main` to review `main...HEAD`.
- `CLAUDE_COMPANION_STOP_REVIEW_ADVERSARIAL=1` to use the adversarial review prompt.

Manual smoke test:

```bash
node scripts/claude-companion.mjs hook-stop-review --json
```

The hook always uses Claude Code `--permission-mode plan` and should not edit files.
