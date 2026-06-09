---
name: claude-adversarial-review
description: Run a stricter structured read-only Claude Code review that searches for subtle defects and weak assumptions.
---

# Claude Adversarial Review

Use this skill when the user wants a stricter read-only review of code changes.

Review uncommitted changes:

```bash
node scripts/claude-companion.mjs adversarial-review
```

Review a branch diff:

```bash
node scripts/claude-companion.mjs adversarial-review --base main
```

Equivalent explicit mode:

```bash
node scripts/claude-companion.mjs review --adversarial --base main
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs adversarial-review --base main --json
```

This uses the same schema, diff collection, and JSON parsing as `claude-review`, but with a stricter prompt that challenges assumptions and looks for concrete failure modes. It always uses Claude Code `--permission-mode plan` and should not edit files.

It also uses the same single-review diff limit as `claude-review`: 200000 bytes by default, configurable with `--max-diff-bytes <n>`.

Use `--effort <level>` to pass Claude Code effort: `low`, `medium`, `high`, `xhigh`, or `max`.
