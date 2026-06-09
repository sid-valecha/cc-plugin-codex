# Worktrees And Subagents

## Recommendation

Do not start parallel implementation immediately. First complete Milestone 0 and 0.5 in one branch so the repo has stable structure, script entry points, and test conventions.

After scaffold/setup exists, split work with git worktrees or subagents.

## Suggested Worktrees

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

## Good Subagent Tasks

Good parallel tasks after scaffold/setup:

- Build fake-Claude fixtures and parser tests.
- Design review schema and prompt.
- Compare parity with `openai/codex-plugin-cc`.
- Improve README and troubleshooting docs.
- Validate Codex plugin manifest and marketplace flow.

Avoid assigning subagents to:

- state schema ownership
- script CLI interface ownership
- process cancellation semantics
- cross-branch merges

Those should stay with the lead agent to avoid subtle incompatibilities.

## Fresh Chat Instructions

Suggested prompt for a new chat:

```text
We are building a Codex plugin that invokes Claude Code as a subprocess. Read plan.md and context/ first. Implement the next incomplete milestone only. Preserve milestone exit criteria, add tests, and do not skip ahead.
```
