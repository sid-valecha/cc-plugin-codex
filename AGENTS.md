# Agent Instructions

This repo is a Codex plugin that invokes Claude Code as a guest subprocess.

Before implementing:

1. Read `plan.md`.
2. Read the `context/` folder.
3. Implement only the next incomplete milestone.
4. Keep each milestone independently usable.
5. Add tests for deterministic script behavior.

Hard rules:

- Use Codex skills, not slash commands, as the user-facing plugin surface.
- Use Claude Code noninteractive `-p` for all plugin-managed Claude invocations.
- Use `--bare` only when strict isolation is explicitly requested and bare-compatible auth is available.
- Treat Claude as an NDJSON subprocess, not a JSON-RPC server.
- Maintain plugin-owned job state instead of relying on `~/.claude/projects` for status/result.
- Do not introduce a broker/multiplexer before the core job runner is stable.
- Do not make hook integration mandatory for setup/rescue/review.
- Do not run real Claude calls unless the user explicitly approves sending prompts/diffs to Claude and spending quota.
- If `claude auth status --text` works in the user's terminal but plugin setup reports unauthenticated, diagnose it as sandbox/keychain visibility. Run Claude-invoking commands only with user approval outside the sandbox, or use bare-compatible auth such as `claude setup-token`, `ANTHROPIC_API_KEY`, provider credentials, or `apiKeyHelper`.

Implementation preferences:

- Runtime: Node.js ESM scripts.
- Entry point: `scripts/claude-companion.mjs`.
- Tests: Node's built-in test runner.
- State: JSON files under the resolved plugin data directory.
- Parser behavior: ignore unknown Claude stream events and preserve raw logs for debugging.

Validation:

```bash
npm test
node --check scripts/claude-companion.mjs
conda run -n cc-plugin-codex-validate python /Users/sidvalecha/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

The `cc-plugin-codex-validate` conda environment exists for plugin validation and includes Python plus PyYAML. Recreate it if needed with:

```bash
conda create -y -n cc-plugin-codex-validate python=3.14 pyyaml
```

Real Claude smoke tests should use `--effort low`. Serious validation should use `--model opus` only when the user approves the cost and quota impact.
