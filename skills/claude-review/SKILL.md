---
name: claude-review
description: Run a structured, read-only Claude Code review over the current git diff or a branch diff.
---

# Claude Review

Use this skill when the user wants Claude Code to review code changes without mutating files.

Review uncommitted changes:

```bash
node scripts/claude-companion.mjs review
```

Review a branch diff:

```bash
node scripts/claude-companion.mjs review --base main
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs review --base main --json
```

Useful options:

- `--cwd <path>` to run from a specific repository.
- `--base <ref>` to review `<ref>...HEAD`.
- `--model <model>` to choose a Claude model. The default is `sonnet`; `spark` maps to `haiku`.
- `--schema <path>` to override the review JSON schema.
- `--max-diff-bytes <n>` to raise or lower the single-review diff limit. The default is 200000 bytes.

Review always uses Claude Code `--permission-mode plan` and one-shot JSON output. It should not edit files.
