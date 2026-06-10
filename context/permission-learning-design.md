# Permission Learning Design

## Status

Deferred design for Milestone 5. This document intentionally does not implement permission learning or pass `--allowedTools` automatically.

## Goal

Help users turn repeated Claude Code permission prompts into a reviewable allowlist. The plugin should propose safe, narrow patterns based on plugin-owned job data and user-approved inputs, then let the user decide whether to feed those patterns back to Claude Code.

## Non-Goals

- Do not auto-approve tools or shell commands.
- Do not infer permissions from `~/.claude/projects` as a primary source of truth.
- Do not write Claude settings without explicit user approval.
- Do not treat permission learning as a replacement for Claude Code permission modes.
- Do not build a broker, multiplexer, or interactive permission proxy.

## Inputs

Use plugin-owned artifacts first:

- `jobs.json` for job kind, status, cwd, model, permission mode, and session id.
- `logs/<job-id>.ndjson` for raw Claude stream events.
- `sessions/<job-id>.json` for normalized session metadata.
- `results/<job-id>.md` only for user-facing summaries, not as a primary parser source.

Optional future inputs:

- Explicit user-provided command history.
- Explicit user-provided Claude settings snippets.
- Explicitly selected log files outside plugin state.

## Candidate Extraction

The analyzer should scan raw stream events and look for structured permission-related signals before falling back to text matching. Good candidates include:

- Claude tool-use events that show a denied or requested tool.
- Hook or permission events that include command/tool names.
- Stderr/result text that clearly contains a permission prompt.

Each candidate should preserve:

- job id
- Claude session id
- workspace path
- event source path
- raw event type
- proposed tool or command pattern
- rationale
- confidence

## Proposed Allowlist Shape

The plugin should produce a proposal file for review, not directly mutate settings:

```json
{
  "version": 1,
  "workspaceRoot": "/absolute/workspace",
  "generatedAt": "2026-06-10T00:00:00.000Z",
  "sourceJobs": ["rescue-..."],
  "candidates": [
    {
      "kind": "tool",
      "pattern": "Bash(npm test)",
      "rationale": "Repeatedly requested during test-fix rescue jobs.",
      "confidence": "high",
      "sourceJobIds": ["rescue-..."]
    }
  ]
}
```

Keep the schema narrow and explicit. Prefer exact commands or tightly scoped prefixes over broad wildcards.

## User Review Flow

1. Run an analyzer command, for example:

   ```bash
   node scripts/claude-companion.mjs permissions analyze --job-id <job-id>
   ```

2. Write a proposal file under plugin state, for example:

   ```text
   permissions/<proposal-id>.json
   ```

3. Show a human summary grouped by risk:

   - exact low-risk commands
   - repo-local file tools
   - networked commands
   - destructive commands
   - broad patterns that should usually be rejected

4. Require the user to edit or approve the proposal before use.

5. Apply only approved entries through an explicit command, for example:

   ```bash
   node scripts/claude-companion.mjs permissions export --proposal-id <id>
   ```

## Feeding Claude Code

Two possible export targets should remain explicit:

- Print `--allowedTools` arguments for a future rescue invocation.
- Generate a Claude settings snippet for the user to copy or review.

Initial implementation should prefer printing explicit command-line arguments because it is reversible and visible in job metadata.

## Risk Rules

Automatically mark these as high risk:

- destructive filesystem commands such as `rm`, `git clean`, or `git reset --hard`
- credential or secret access
- network writes, deployment commands, package publishing
- broad shells such as unrestricted `Bash(*)`
- commands outside the workspace

Automatically mark these as low or medium only when narrow:

- read-only file inspection
- test commands already used in project docs
- formatter/linter commands from project scripts
- repo-local build commands that do not publish or deploy

## Suggested Future CLI

These are deliberately future-facing and should not be treated as implemented:

```bash
node scripts/claude-companion.mjs permissions analyze [--job-id <id>] [--cwd <path>]
node scripts/claude-companion.mjs permissions show --proposal-id <id>
node scripts/claude-companion.mjs permissions export --proposal-id <id> --format allowed-tools
```

Future rescue integration could accept:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --allowed-tools-file <path>
```

## Test Plan

Use fake-Claude fixtures only:

- permission prompt event produces a narrow candidate
- unrelated events produce no candidates
- destructive commands are marked high risk
- duplicate candidates are merged with multiple source job ids
- proposals preserve source job/session metadata
- export refuses unapproved proposals

## Open Questions

- Exact Claude Code event shape for permission prompts in stream-json output.
- Whether `--allowedTools` accepts all desired patterns in the current Claude Code version.
- Whether exported snippets should target user-level settings, workspace settings, or command-line only.
- How much redaction is needed before displaying raw command arguments in proposals.
