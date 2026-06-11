# Frictionless User Setup

## Goal

Normal users should not need to understand Codex sandbox internals, Claude Code
permission modes, or nested approvals. The intended first-run experience is:

1. Install the plugin.
2. Use a Codex profile that routes approval prompts to the user.
3. Approve the narrow Claude delegation command once when Codex prompts.
4. Use skills such as `claude-rescue`, `claude-plan`, `claude-ui`, and
   `claude-review` normally.

## Recommended Local Profile

For unmanaged local Codex installs, create:

```text
~/.codex/claude-companion.config.toml
```

With:

```toml
approval_policy = "on-request"
approvals_reviewer = "user"
sandbox_mode = "workspace-write"
```

Launch Codex with:

```bash
codex --profile claude-companion
```

This keeps approvals interactive and user-owned instead of routing the Claude
delegation command through automatic review. On first real Claude use, approve
the narrow plugin command prefix when Codex prompts, for example:

```text
node <codex-plugin-cache>/cc-plugin-codex/0.1.0/scripts/claude-companion.mjs rescue
```

Do not approve broad `node` access unless the user explicitly wants that.

## Plugin-Level Smoothness

After Codex is allowed to start Claude, use plugin options to avoid Claude
Code's nested noninteractive tool prompt:

```bash
--trust-local-dev
```

or narrower patterns:

```bash
--allow-tool "Bash(python3 -m unittest*)"
--allowed-tools-file ./claude-allowed-tools.txt
```

This solves Claude Code's internal tool approval layer. It does not grant Codex
permission to disclose workspace context to Claude; that must be allowed by the
Codex host/user policy first.

## Managed Or Restricted Environments

If organization or tenant policy forces `approvals_reviewer = "auto_review"` and
the reviewer denies external Claude disclosure, the plugin cannot make live
Claude calls frictionless. This is a host policy block, not a Claude auth issue
and not a plugin bug.

In that case, users or admins need one of:

- allow user-reviewed approvals for this workflow
- allow the narrow plugin delegation prefixes
- provide a managed approval policy that permits the external Claude disclosure
  for approved repositories

The plugin must not bypass a tenant/host disclosure denial.

## Future OSS Enhancements

- Add a `claude-setup` diagnostic that prints the profile snippet when a live
  rescue/review is blocked by host policy.
- Add a small command that writes the `claude-companion.config.toml` profile
  after explicit user approval.
- Add managed-environment docs for admins, including sample allowed prefixes and
  risk rationale.
- Investigate whether Codex exposes a stable persistent command-approval API for
  plugins. If it does, wire first-run setup to request the exact prefix.
