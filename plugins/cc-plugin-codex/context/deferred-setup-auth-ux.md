# Deferred Setup Auth UX

## Problem

Claude Pro OAuth/keychain auth can be visible in a user's normal terminal while
being hidden from a sandboxed Codex command process. In that case:

- `claude auth status --text` succeeds in the user's terminal.
- `node scripts/claude-companion.mjs setup --json` can report
  `claudeAuth.status: unauthenticated` inside the sandbox.
- Running the same setup command with user-approved outside-sandbox execution can
  report `claudeAuth.ok: true`.

This is different from `--bare`. Bare mode intentionally does not use normal
OAuth/keychain auth and requires bare-compatible auth such as
`claude setup-token`, `ANTHROPIC_API_KEY`, Bedrock, Vertex, or `apiKeyHelper`.
The sandbox/keychain issue can happen in standard non-bare mode because the host
process cannot see the auth state that already exists.

## Current Handling

The setup guidance and troubleshooting docs explicitly tell users to approve the
Claude-invoking command outside the sandbox or configure bare-compatible auth.
This keeps the behavior correct without making an unauthenticated sandbox look
like a broken install.

## Implemented Smoothness Improvement

The minimal `setup` rendering polish is implemented. Human setup output now
directly distinguishes auth that is missing or hidden from the current process:

> Claude auth is not ready or not visible to this process.

Guidance also tells users that if `claude auth status --text` works in a normal
terminal, they should approve the Claude command outside the sandbox or use
token/API/provider auth.

## Later Smoothness Improvement

A fuller version could add an optional explicit diagnostic path, for example:

```bash
node scripts/claude-companion.mjs setup --auth-sandbox-help
```

That command should remain non-billable and should not invoke Claude with a
prompt. It should not try to bypass sandbox policy automatically.

## Estimate

- Optional explicit diagnostic command: 1-2 hours, including tests and docs.
