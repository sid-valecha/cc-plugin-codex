---
name: claude-result
description: Read the latest or selected Claude Code companion job result.
---

# Claude Result

Use this skill when the user wants the result from a completed or running Claude companion job.

Run:

```bash
node scripts/claude-companion.mjs result
```

For a specific job:

```bash
node scripts/claude-companion.mjs result --job-id <job-id>
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs result --job-id <job-id> --json
```

Useful options:

- `--state-dir <path>` to inspect a non-default plugin data directory.

Human output prints job metadata before the result body, including Claude session id, model, effort, permission mode, isolation, exit information when relevant, model usage when available, and useful follow-up commands.
