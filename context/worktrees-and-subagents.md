# Worktrees And Subagents

## Recommendation

This file is a historical coordination note from early implementation. The
scaffold, setup, rescue/jobs, review, hook, polish, and RC docs work are now
implemented on `main`.

For future work, prefer focused branches for code/runtime changes and direct
docs commits only for low-risk documentation edits. Use worktrees or subagents
only when the work can be cleanly split without competing over
`scripts/claude-companion.mjs` interfaces.

## Historical Suggested Worktrees

- `feat/scaffold-setup`: Milestone 0 and 0.5
- `feat/rescue-jobs`: Milestone 1 and 1.5
- `feat/review`: Milestone 2 and 3
- `feat/hooks`: Milestone 4

Merge order:

1. `feat/scaffold-setup`
2. `feat/rescue-jobs`
3. `feat/review`
4. `feat/hooks`

Rationale:

- Rescue/jobs and review both need the script conventions from scaffold/setup.
- Hooks should come after core skills so hook trust and hook failures do not block the useful plugin.

## Good Future Subagent Tasks

Good bounded future tasks:

- Build fake-Claude fixtures and parser tests.
- Design review schema and prompt.
- Compare any new parity questions with `openai/codex-plugin-cc`.
- Improve README, release notes, or troubleshooting docs.
- Validate Codex plugin manifest, marketplace flow, and release checklist.

Avoid assigning subagents to:

- state schema ownership
- script CLI interface ownership
- process cancellation semantics
- cross-branch merges

Those should stay with the lead agent to avoid subtle incompatibilities.

## Fresh Chat Instructions

Suggested prompt for a new chat:

```text
We are building a Codex plugin that invokes Claude Code as a subprocess. Read plan.md and context/ first. Preserve milestone boundaries and tests. Current release-candidate status and the remaining gate are tracked in context/next-roadmap.md, context/release-checklist.md, and context/release-notes.md.
```
