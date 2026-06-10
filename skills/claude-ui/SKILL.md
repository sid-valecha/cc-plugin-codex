---
name: claude-ui
description: Ask Claude Code for frontend UI/design implementation, critique, visual hierarchy, responsive layout, or design polish.
---

# Claude UI

Use this skill when the user wants Claude Code's help building or polishing frontend UI, landing pages, product flows, responsive layout, accessibility, or visual design details.

Real UI/design calls can send prompts and workspace context to Claude Code and may spend quota. If the Codex host offers persistent approvals, ask the user to approve the narrow prefixes `node scripts/claude-companion.mjs ui` and `node scripts/claude-companion.mjs design` instead of broad commands like `node`. If host policy blocks external disclosure, do not bypass it.

If the host approval system denies the UI/design command because it would disclose workspace context to Claude, stop and report that Claude UI/design was blocked. Do not silently complete the task locally with Codex during a Claude integration smoke test. Only fall back to local Codex implementation if the user explicitly asks for a local fallback after the block is reported.

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
- Use `--trust-local-dev` in trusted local frontend projects when Claude should be allowed to edit files and run common local test commands without a nested Claude approval stop.
- Use `--allow-tool <pattern>` or `--allowed-tools-file <path>` for narrower approved Claude Code tool patterns.
- Use `--model opus` for serious design decisions when the user approves cost and quota impact.
- Use `--effort low` for cheap smoke checks.

If Claude Code requests tool approval during noninteractive UI work, the plugin reports `permission_blocked`. Surface the blocked tool and suggest `--trust-local-dev` only for trusted local repositories, or a narrower `--allow-tool` pattern.

Host/Codex approval and Claude Code tool approval are separate layers. Host denial happens before Claude runs; `permission_blocked` happens after Claude starts and requests its own tool approval.
