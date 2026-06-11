---
name: claude-setup
description: Diagnose whether Claude Code is installed and authenticated for this local Codex plugin without making a billable Claude call.
---

# Claude Setup

Use this skill when the user wants to check whether Claude Code is available for the Codex Claude companion plugin, or when Claude delegation fails before a task starts.

Run the setup diagnostic with the companion script from the installed plugin
root. If the current working directory is not this plugin checkout, do not first
try `node scripts/claude-companion.mjs`; resolve the script relative to this
skill file, for example `../../scripts/claude-companion.mjs` from the skill
directory.

From the plugin root:

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

- `claude auth login --claudeai` for Claude subscription accounts
- `claude setup-token` for long-lived subscription auth in strict bare mode
- `ANTHROPIC_API_KEY`
- `CLAUDE_CODE_USE_BEDROCK=1` with AWS credentials
- `CLAUDE_CODE_USE_VERTEX=1` with GCP credentials
- Claude Code `apiKeyHelper`

The setup command treats `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_USE_BEDROCK=1`, or `CLAUDE_CODE_USE_VERTEX=1` as configured
environment auth and reports `claudeAuth.status: "env_configured"`. Claude Code
still validates API keys or provider credentials at runtime.

If `claude auth status --text` succeeds in the user's normal terminal but the plugin setup check reports unauthenticated, treat it as a sandbox/keychain visibility problem instead of a missing login. Ask the user to approve the Claude-invoking command outside the sandbox, or guide them to bare-compatible auth such as `claude setup-token`, `ANTHROPIC_API_KEY`, provider credentials, or `apiKeyHelper`.

For a smoother unmanaged local Codex setup, recommend a one-time profile that
routes approvals to the user:

```bash
cat > ~/.codex/claude-companion.config.toml <<'EOF'
approval_policy = "on-request"
approvals_reviewer = "user"
sandbox_mode = "workspace-write"
EOF
codex --profile claude-companion
```

If organization policy forces automatic approval review and denies external
Claude disclosure, the plugin cannot bypass that policy. Tell the user that an
admin or workspace policy must allow the narrow Claude delegation command
prefixes before live Claude calls can run.

Do not run a prompt through Claude as part of setup.
