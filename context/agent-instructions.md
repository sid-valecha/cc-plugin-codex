# Agent Instructions

This repo is intended to become a Codex plugin that invokes Claude Code as a guest subprocess.

Before implementing:

1. Read `plan.md`.
2. Read this `context/` folder.
3. Implement only the next incomplete milestone.
4. Keep each milestone independently usable.
5. Add tests for any deterministic script behavior.

Hard rules:

- Use Codex skills, not slash commands, as the user-facing plugin surface.
- Use Claude Code noninteractive `-p` for all plugin-managed Claude invocations.
- Use `--bare` only when strict isolation is explicitly requested and bare-compatible auth is available.
- Treat Claude as an NDJSON subprocess, not a JSON-RPC server.
- Maintain plugin-owned job state instead of relying on `~/.claude/projects` for status/result.
- Do not introduce a broker/multiplexer before the core job runner is stable.
- Do not make hook integration mandatory for setup/rescue/review.

Default implementation preferences:

- Runtime: Node.js ESM scripts.
- Entry point: `scripts/claude-companion.mjs`.
- Tests: Node's built-in test runner unless a stronger need appears.
- State: JSON files under a resolved plugin data directory.
- Parser behavior: ignore unknown Claude stream events and preserve raw logs for debugging.

If using subagents, give each subagent one bounded area and require it to report exact files changed, tests run, and remaining risks.
