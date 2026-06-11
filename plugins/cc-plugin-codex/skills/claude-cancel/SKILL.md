---
name: claude-cancel
description: Cancel a running Claude Code companion job by sending process signals through the plugin job index.
---

# Claude Cancel

Use this skill when the user wants to stop a running Claude companion job.

Use the companion script from the installed plugin root. If the current working
directory is not this plugin checkout, resolve the script relative to this skill
file, for example `../../scripts/claude-companion.mjs`.

Cancel the latest running job:

```bash
node scripts/claude-companion.mjs cancel
```

Cancel a specific job:

```bash
node scripts/claude-companion.mjs cancel --job-id <job-id>
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs cancel --job-id <job-id> --json
```

Cancellation sends `SIGINT` first and escalates to `SIGTERM` after a short grace period if the process is still present.
