---
name: claude-ui
description: Ask Claude Code for frontend UI/design implementation, critique, visual hierarchy, responsive layout, or design polish.
---

# Claude UI

Use this skill when the user wants Claude Code's help building or polishing frontend UI, landing pages, product flows, responsive layout, accessibility, or visual design details.

Run a write-capable UI/design task:

```bash
node scripts/claude-companion.mjs ui --prompt "<ui or design request>"
```

Run a read-only UI critique:

```bash
node scripts/claude-companion.mjs ui --prompt "<ui or design request>" --plan
```

The `design` subcommand is an alias:

```bash
node scripts/claude-companion.mjs design --prompt "<ui or design request>"
```

Behavior:

- Adds a frontend/product-design prompt scaffold before the user's request.
- Uses write-capable `acceptEdits` by default because UI polish often needs file edits.
- Uses read-only `plan` permission mode when `--plan` is supplied.
- Supports normal rescue options such as `--cwd`, `--model`, `--effort`, `--background`, `--wait`, `--resume`, `--fresh`, and `--state-dir`.
- Use `--model opus` for serious design decisions when the user approves cost and quota impact.
- Use `--effort low` for cheap smoke checks.
