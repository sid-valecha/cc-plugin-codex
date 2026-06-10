---
name: claude-adversarial-review
description: Compatibility alias for stricter Claude review; prefer claude-review with --adversarial for new use.
---

# Claude Adversarial Review

Use `claude-review` with `--adversarial` for new stricter reviews. This compatibility skill remains available for parity with earlier plugin versions.

Real adversarial review calls send diffs and review prompts to Claude Code and may spend quota. If the Codex host offers persistent approvals, prefer approving the narrow prefix `node scripts/claude-companion.mjs review` and running `review --adversarial` instead of approving a separate adversarial command. If host policy blocks external disclosure, do not bypass it.

Review uncommitted changes:

```bash
node scripts/claude-companion.mjs adversarial-review
```

Review a branch diff:

```bash
node scripts/claude-companion.mjs adversarial-review --base main
```

Equivalent explicit mode:

```bash
node scripts/claude-companion.mjs review --adversarial --base main
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs adversarial-review --base main --json
```

This uses the same schema, diff collection, and JSON parsing as `claude-review`, but with a stricter prompt that challenges assumptions and looks for concrete failure modes. It always uses Claude Code `--permission-mode plan` and should not edit files.

It also uses the same single-review diff limit as `claude-review`: 200000 bytes by default, configurable with `--max-diff-bytes <n>`.

Use `--effort <level>` to pass Claude Code effort: `low`, `medium`, `high`, `xhigh`, or `max`.

Model guidance:

- Use `--model opus` for serious adversarial review, merge readiness, or high-risk design validation.
- Use `--effort low` only for smoke tests, cheap sanity checks, or explicitly low-effort requests.
- Do not assume short aliases always map to the expected backend model. After real Claude calls, inspect and report actual model usage from JSON output when available.
