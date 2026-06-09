# Claude Code Companion for Codex

This repository contains a Codex plugin that lets Codex use Claude Code as a local guest subprocess. The current implementation covers Milestone 0 and Milestone 0.5 only: plugin scaffold plus setup diagnostics.

## Quickstart

Run the setup check from the plugin root:

```bash
node scripts/claude-companion.mjs setup
```

For JSON output:

```bash
node scripts/claude-companion.mjs setup --json
```

The setup check is non-billable. It only runs:

- `node --version`
- `npm --version`
- `claude --version`
- `claude auth status --text`

If Claude Code is missing, install it with:

```bash
npm install -g @anthropic-ai/claude-code
claude install stable
```

If auth is missing, use `claude auth login`, `ANTHROPIC_API_KEY`, Bedrock with `CLAUDE_CODE_USE_BEDROCK=1`, Vertex with `CLAUDE_CODE_USE_VERTEX=1`, or Claude Code `apiKeyHelper`.

## Codex Skill

The initial user-facing skill is:

- `claude-setup`: diagnose local Claude Code installation and auth without sending a prompt to Claude.

Future skills such as rescue, status, result, cancel, review, hooks, and worktree workflows are intentionally not implemented in this milestone.

## Development

This project uses Node ESM and Node's built-in test runner.

```bash
npm test
```

Plugin validation can be run with the local plugin-creator validator:

```bash
python3 /Users/sidvalecha/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

Tests use a fake `claude` executable placed first on `PATH`, so they do not require a local Claude install and do not make billable calls.
