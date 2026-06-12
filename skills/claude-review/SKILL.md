---
name: claude-review
description: Run a structured, read-only Claude Code review over the current git diff or a branch diff.
---

# Claude Review

Use this skill when the user wants Claude Code to review code changes without mutating files.

Use the companion script from the installed plugin root. If the current working
directory is not this plugin checkout, resolve the script relative to this skill
file, for example `../../scripts/claude-companion.mjs`, and pass `--cwd
<target-repo>` for the repository being reviewed.

Real review calls send diffs and review prompts to Claude Code and may spend quota. If the Codex host offers persistent approvals, ask the user to approve the narrow prefix `node scripts/claude-companion.mjs review` instead of broad commands like `node`. If host policy blocks external disclosure, do not bypass it.

Review uncommitted changes:

```bash
node scripts/claude-companion.mjs review
```

Review a branch diff:

```bash
node scripts/claude-companion.mjs review --base main
```

Run a stricter review over the same schema:

```bash
node scripts/claude-companion.mjs review --adversarial --base main
```

For machine-readable output:

```bash
node scripts/claude-companion.mjs review --base main --json
```

Useful options:

- `--cwd <path>` to run from a specific repository.
- `--base <ref>` to review `<ref>...HEAD`.
- `--model <model>` to choose a Claude model. The default is `sonnet`; use Claude model names or full Claude model IDs.
- `--effort <level>` to pass Claude Code effort: `low`, `medium`, `high`, `xhigh`, or `max`.
- `--schema <path>` to override the review JSON schema.
- `--max-diff-bytes <n>` to raise or lower the single-review diff limit. The default is 200000 bytes.
- `--timeout-ms <n>` to cap the Claude review subprocess runtime. The default is 600000 milliseconds.
- `--adversarial` to use a stricter prompt that challenges assumptions and looks for subtle concrete failure modes.
- `--include-untracked` to explicitly include untracked files in the default review diff.

Default review includes tracked staged and unstaged changes. It does not include untracked files unless `--include-untracked` is set. Review always uses Claude Code `--permission-mode plan` and one-shot JSON output. It should not edit files. Foreground review commands create plugin-owned job state and log files before invoking Claude, so use `claude-status`, `claude-result`, or `claude-cancel` if a review is still running or needs to be inspected from another shell.

Model guidance:

- Use `--model opus` for serious reviews, merge readiness, hook gate validation, or high-risk changes.
- Use `--effort low` for smoke tests, cheap sanity checks, or explicitly low-effort requests.
- Do not assume short Claude model names always map to the expected backend model. Live smoke tests showed `sonnet` and `opus` matching their requested families, but a `haiku` request initialized as Haiku and still reported `claude-sonnet-4-6` in actual usage. After real Claude calls, inspect and report actual model usage from JSON output when available.
