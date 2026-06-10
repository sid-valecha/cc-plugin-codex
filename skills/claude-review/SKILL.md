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
- `--effort <level>` to pass Claude Code effort: `low`, `medium`, `high`, `xhigh`, or `max`.
- `--schema <path>` to override the review JSON schema.
- `--max-diff-bytes <n>` to raise or lower the single-review diff limit. The default is 200000 bytes.

Review always uses Claude Code `--permission-mode plan` and one-shot JSON output. It should not edit files.

Model guidance:

- Use `--model opus` for serious reviews, merge readiness, hook gate validation, or high-risk changes.
- Use `--effort low` for smoke tests, cheap sanity checks, or explicitly low-effort requests.
- Do not assume short aliases always map to the expected backend model. After real Claude calls, inspect and report actual model usage from JSON output when available.
