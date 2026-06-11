# Host Permissions For Claude Calls

## Requirement

This plugin is useful only when the Codex host is allowed to invoke Claude Code
as an external AI subprocess. Real `rescue`, `plan`, `ui`, `review`,
`adversarial-review`, and enabled Stop-hook review calls can send prompts,
diffs, or workspace context to Claude Code and may spend Claude quota.

The plugin cannot grant this permission to itself. The Codex host, user, or
organization policy must allow the external call.

## Persistent Approval

When the Codex host supports persistent command approvals, users should approve
narrow command prefixes for this plugin instead of broad commands such as
`node` or `python`.

Recommended prefixes:

- `node scripts/claude-companion.mjs rescue`
- `node scripts/claude-companion.mjs plan`
- `node scripts/claude-companion.mjs ui`
- `node scripts/claude-companion.mjs design`
- `node scripts/claude-companion.mjs review`

Optional, only when the Stop hook is intentionally enabled:

- `node hooks/claude-stop-review.mjs`

Approve only the modes that should be available in the environment. For
example, a read-only environment may approve `plan` and `review` but not
write-capable `rescue` or `ui`. Stricter adversarial review should usually use
`review --adversarial`, so it does not need a separate first-run approval.

## Smooth Local Profile

For unmanaged local Codex installs, users can make approval prompts user-owned
instead of automatic-reviewer-owned with a profile:

```bash
cat > ~/.codex/claude-companion.config.toml <<'EOF'
approval_policy = "on-request"
approvals_reviewer = "user"
sandbox_mode = "workspace-write"
EOF
```

Then start Codex with:

```bash
codex --profile claude-companion
```

On the first live Claude call, approve the narrow plugin delegation command
Codex shows. This is the preferred frictionless path for personal/local users:
one profile plus one narrow approval, then normal `claude-rescue`,
`claude-plan`, `claude-ui`, and `claude-review` use.

## Policy Blocks

If the host or tenant policy blocks external disclosure, the plugin must not
try to work around that block. In that environment, only local/non-billable
commands such as `setup`, `status`, `result`, `cancel`, and permission proposal
inspection are expected to work.

When a Claude delegation command is denied by the Codex host or automatic
approval reviewer, treat that denial as the result of the plugin smoke test.
Do not report a fallback Codex implementation as a successful Claude run. A
local Codex fallback can still be useful, but it should happen only after the
user explicitly asks to proceed without Claude.

This is separate from `permission_blocked`:

- Host denial means Codex did not start a Claude call because external
  disclosure was not allowed.
- `permission_blocked` means Claude Code started successfully but then requested
  approval for one of its own tools during noninteractive execution.

If a managed organization forces `approvals_reviewer = "auto_review"` and that
reviewer denies external Claude disclosure, the user cannot locally configure
around it. An admin or workspace policy must allow user-reviewed approvals,
permit the narrow plugin prefixes, or otherwise approve this external Claude
delegation workflow.

## Auth Is Separate

Host permission is separate from Claude auth:

- Claude auth decides whether Claude Code can talk to Anthropic.
- Host permission decides whether Codex may start a Claude call that can send
  private workspace context to Claude.

Both must be ready for real Claude calls.
