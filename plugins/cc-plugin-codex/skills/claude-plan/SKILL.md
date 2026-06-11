---
name: claude-plan
description: Ask Claude Code for read-only planning, architecture, systems-design, migration, or debugging strategy help.
---

# Claude Plan

Use this skill when the user wants Claude Code's help planning a complex change, evaluating architecture tradeoffs, designing a migration, or building a debugging strategy.

Use the companion script from the installed plugin root. If the current working
directory is not this plugin checkout, resolve the script relative to this skill
file, for example `../../scripts/claude-companion.mjs`, and pass `--cwd
<target-repo>` for the repository being planned.

Real planning calls can send prompts and workspace context to Claude Code and may spend quota. If the Codex host offers persistent approvals, ask the user to approve the narrow prefix `node scripts/claude-companion.mjs plan` instead of broad commands like `node`. If host policy blocks external disclosure, do not bypass it.

Run:

```bash
node scripts/claude-companion.mjs plan --prompt "<planning request>"
```

For serious architecture or system-design work, prefer `--model opus` when the user approves cost and quota impact:

```bash
node scripts/claude-companion.mjs plan --prompt "<planning request>" --model opus
```

For cheap smoke checks, use:

```bash
node scripts/claude-companion.mjs plan --prompt "<planning request>" --effort low
```

Behavior:

- Always uses Claude Code read-only `plan` permission mode.
- Adds a planning-focused prompt scaffold before the user's request.
- Does not edit files by default.
- Supports normal rescue options such as `--cwd`, `--model`, `--effort`, `--background`, `--wait`, `--resume`, `--fresh`, and `--state-dir`.
