---
name: claude-permissions
description: Analyze plugin-owned Claude Code job logs for permission prompts and export reviewed allowedTools arguments.
---

# Claude Permissions

Use this skill when the user wants to review repeated Claude Code permission prompts and produce explicit allowlist arguments for future Claude runs.

Use the companion script from the installed plugin root. If the current working
directory is not this plugin checkout, resolve the script relative to this skill
file, for example `../../scripts/claude-companion.mjs`.

Analyze a specific job:

```bash
node scripts/claude-companion.mjs permissions analyze --job-id <job-id>
```

Analyze recent jobs for the current workspace:

```bash
node scripts/claude-companion.mjs permissions analyze
```

Show a proposal:

```bash
node scripts/claude-companion.mjs permissions show --proposal-id <proposal-id>
```

Export reviewed proposal entries as Claude Code `--allowedTools` arguments:

```bash
node scripts/claude-companion.mjs permissions export --proposal-id <proposal-id> --format allowed-tools
```

Rules:

- Use only plugin-owned job state and logs.
- Do not read `~/.claude/projects` as a primary source of truth.
- Do not auto-approve tools or commands.
- Export only after the proposal file has been reviewed and explicitly edited to set `"approved": true`.
- Do not feed exported tools into rescue automatically.
