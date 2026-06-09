---
name: claude-status
description: List active and recent Claude Code companion jobs from the plugin job index.
---

# Claude Status

Use this skill when the user wants to see active or recent Claude companion jobs.

Run:

```bash
node scripts/claude-companion.mjs status
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs status --json
```

Useful options:

- `--state-dir <path>` to inspect a non-default plugin data directory.
- `--limit <n>` to limit the number of jobs shown.
