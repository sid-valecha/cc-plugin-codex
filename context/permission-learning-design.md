# Permission Learning Design

## Status

Initial Milestone 5 implementation exists for `permissions analyze`, `permissions show`, and `permissions export --format allowed-tools`.

Release-candidate polish added explicit rescue integration:

- `--allow-tool <pattern>` passes a reviewed Claude Code allowed tool pattern.
- `--allowed-tools-file <path>` reads patterns from a JSON array or newline file.
- `--trust-local-dev` applies a curated local development preset for trusted repositories.
- Claude tool-approval stops are reported as `permission_blocked`, not silent success.

## Goal

Help users turn repeated Claude Code permission prompts into a reviewable allowlist. The plugin should propose safe, narrow patterns based on plugin-owned job data and user-approved inputs, then let the user decide whether to feed those patterns back to Claude Code.

## Non-Goals

- Do not auto-approve tools or shell commands.
- Do not infer permissions from `~/.claude/projects` as a primary source of truth.
- Do not write Claude settings without explicit user approval.
- Do not treat permission learning as a replacement for Claude Code permission modes.
- Do not build a broker, multiplexer, or interactive permission proxy.
- Do not make `--trust-local-dev` the implicit default for untrusted repositories.

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

Initial implementation prefers explicit command-line arguments because it is reversible and visible in job metadata.

Current rescue integration accepts:

```bash
node scripts/claude-companion.mjs rescue --prompt "<task>" --allow-tool "Bash(npm test*)"
node scripts/claude-companion.mjs rescue --prompt "<task>" --allowed-tools-file ./allowed-tools.txt
node scripts/claude-companion.mjs rescue --prompt "<task>" --trust-local-dev
```

`--trust-local-dev` is a convenience preset for trusted local repositories. It
intentionally allows common file/search/edit tools and common local test
commands, but does not bypass all permissions.

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

## Current CLI

```bash
node scripts/claude-companion.mjs permissions analyze [--job-id <id>] [--cwd <path>]
node scripts/claude-companion.mjs permissions show --proposal-id <id>
node scripts/claude-companion.mjs permissions export --proposal-id <id> --format allowed-tools
node scripts/claude-companion.mjs rescue --prompt "<task>" --allow-tool "Bash(npm test*)"
node scripts/claude-companion.mjs rescue --prompt "<task>" --allowed-tools-file <path>
node scripts/claude-companion.mjs rescue --prompt "<task>" --trust-local-dev
```

## Future Enhancements

These are intentionally left open for OSS follow-up work:

- Interactive permission bridge: surface Claude Code permission requests back to
  Codex/user in real time and continue the same Claude subprocess after approval,
  if Claude Code exposes a stable noninteractive permission-prompt protocol.
- Settings writer: generate or update Claude Code settings only after explicit
  user approval, with scoped project/user placement.
- Preset expansion: add language/framework presets such as `python`, `node`,
  `frontend`, or `go` after real-world usage shows the right narrow patterns.
- Better event parsing: prefer structured Claude Code permission events over
  text matching when the stream-json event shape is stable.
- Risk UI: group proposed tools by low/medium/high risk before export.
- Sandbox-aware mode: combine Claude Code sandbox settings with broader command
  allowances when the environment is explicitly isolated.

## Test Plan

Use fake-Claude fixtures only:

- permission prompt event produces a narrow candidate
- permission-blocked rescue output returns `status: permission_blocked`
- `--allow-tool`, `--allowed-tools-file`, and `--trust-local-dev` pass expected
  Claude Code arguments
- unrelated events produce no candidates
- destructive commands are marked high risk
- duplicate candidates are merged with multiple source job ids
- proposals preserve source job/session metadata
- export refuses unapproved proposals

## Open Questions

- Exact Claude Code event shape for permission prompts in stream-json output.
- Whether a real-time permission continuation protocol exists for stable noninteractive use.
- Whether exported snippets should target user-level settings, workspace settings, or command-line only.
- How much redaction is needed before displaying raw command arguments in proposals.
