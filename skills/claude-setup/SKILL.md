---
name: claude-setup
description: Diagnose whether Claude Code is installed and authenticated for this local Codex plugin without making a billable Claude call.
---

# Claude Setup

Use this skill when the user wants to check whether Claude Code is available for the Codex Claude companion plugin, or when Claude delegation fails before a task starts.

Run the setup diagnostic from the plugin root:

```bash
node scripts/claude-companion.mjs setup
```

For machine-readable output, run:

```bash
node scripts/claude-companion.mjs setup --json
```

The setup diagnostic is intentionally non-billable. It only checks:

- `node --version`
- `npm --version`
- `claude --version`
- `claude auth status --text`

If Claude Code is missing, guide the user to install it with:

```bash
npm install -g @anthropic-ai/claude-code
claude install stable
```

If Claude Code is unauthenticated, guide the user to use one of:

- `claude auth login`
- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_USE_BEDROCK=1` with AWS credentials
- `CLAUDE_CODE_USE_VERTEX=1` with GCP credentials
- Claude Code `apiKeyHelper`

Do not run a prompt through Claude as part of setup.
