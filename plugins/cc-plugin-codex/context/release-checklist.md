# Release Checklist

Use this checklist before tagging or sharing a release-candidate build. Real
Claude calls require explicit user approval because prompts, diffs, and
workspace context can be sent to Claude Code and may spend quota.

## 1. Clean Checkout

```bash
git status --short --branch
git fetch origin
git status --short --branch
```

Pass criteria:

- The working tree is clean.
- The release branch is aligned with its upstream branch.

## 2. Deterministic Validation

```bash
npm test
node --check scripts/claude-companion.mjs
python "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/validate_plugin.py" .
```

Pass criteria:

- All fake-Claude tests pass.
- `node --check` exits successfully.
- Plugin validation passes.

## 3. Local Install Refresh

For personal/local validation:

```bash
codex plugin add cc-plugin-codex@personal
```

If the marketplace name is not `personal`, read it first:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/read_marketplace_name.py"
codex plugin add cc-plugin-codex@<marketplace-name>
```

Validate the installed cache copy:

```bash
PLUGIN_CACHE="${CODEX_HOME:-$HOME/.codex}/plugins/cache/personal/cc-plugin-codex/0.1.0"
python "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/validate_plugin.py" "$PLUGIN_CACHE"
node --check "$PLUGIN_CACHE/scripts/claude-companion.mjs"
```

Pass criteria:

- Reinstall succeeds.
- Installed-cache plugin validation passes.
- Installed-cache script syntax check passes.
- Start a fresh Codex thread after reinstalling so skill metadata is reloaded.

## 4. Non-Billable Runtime Checks

Run setup/status diagnostics from the installed cache when possible:

```bash
PLUGIN_CACHE="${CODEX_HOME:-$HOME/.codex}/plugins/cache/personal/cc-plugin-codex/0.1.0"
node "$PLUGIN_CACHE/scripts/claude-companion.mjs" setup --json
node "$PLUGIN_CACHE/scripts/claude-companion.mjs" status --limit 5
```

Pass criteria:

- `setup --json` reports Node, npm, Claude Code, and Claude auth status.
- If Claude auth is hidden from the process, setup output clearly says auth may
  be missing or not visible and gives the next fix.
- `status` renders without crashing, even when there are no jobs.

## 5. Low-Cost Real Claude Smokes

Run only after explicit approval. Use `--effort low` and a throwaway fixture.
Record actual `modelUsage`; do not assume short model aliases route to a
specific Claude model.

Prepare a calculator fixture:

```bash
SMOKE_DIR="$(mktemp -d /private/tmp/cc-plugin-codex-smoke-python-calc.XXXXXX)"
cat > "$SMOKE_DIR/calculator.py" <<'PY'
"""Tiny calculator fixture for Claude Code Companion smoke tests."""

def add(a, b):
    return a + b

def subtract(a, b):
    return a - b

def multiply(a, b):
    return a * b

def divide(a, b):
    if b == 0:
        raise ValueError("cannot divide by zero")
    return a / b

def power(a, b):
    return a ** b
PY
cat > "$SMOKE_DIR/test_calculator.py" <<'PY'
import unittest

from calculator import add, divide, multiply, power, subtract

class CalculatorTests(unittest.TestCase):
    def test_basic_operations(self):
        self.assertEqual(add(2, 3), 5)
        self.assertEqual(subtract(7, 4), 3)
        self.assertEqual(multiply(6, 5), 30)
        self.assertEqual(divide(8, 2), 4)

    def test_divide_by_zero(self):
        with self.assertRaisesRegex(ValueError, "cannot divide by zero"):
            divide(1, 0)

    def test_power(self):
        self.assertEqual(power(2, 5), 32)
        self.assertEqual(power(9, 0), 1)

if __name__ == "__main__":
    unittest.main()
PY
```

Plan smoke:

```bash
PLUGIN_CACHE="${CODEX_HOME:-$HOME/.codex}/plugins/cache/personal/cc-plugin-codex/0.1.0"
node "$PLUGIN_CACHE/scripts/claude-companion.mjs" plan --cwd "$SMOKE_DIR" --prompt "Smoke test only. Inspect this tiny calculator fixture and propose the smallest plan to add one new operation without editing files. Reply with concise bullets and do not modify files." --effort low --model sonnet --json
```

UI plan smoke:

```bash
PLUGIN_CACHE="${CODEX_HOME:-$HOME/.codex}/plugins/cache/personal/cc-plugin-codex/0.1.0"
node "$PLUGIN_CACHE/scripts/claude-companion.mjs" ui --cwd "$SMOKE_DIR" --plan --prompt "Smoke test only. Treat this tiny calculator fixture as a developer-facing utility. Suggest one small UX or readability improvement without editing files. Reply concisely." --effort low --model sonnet --json
```

Background wait smoke:

```bash
PLUGIN_CACHE="${CODEX_HOME:-$HOME/.codex}/plugins/cache/personal/cc-plugin-codex/0.1.0"
node "$PLUGIN_CACHE/scripts/claude-companion.mjs" rescue --cwd "$SMOKE_DIR" --background --wait --wait-timeout-ms 120000 --permission-mode plan --effort low --model sonnet --prompt "Background wait smoke test only. Inspect the tiny calculator fixture and reply with exactly OK. Do not edit files." --json
```

Prepare a review fixture with a seeded bug:

```bash
REVIEW_SMOKE_DIR="$(mktemp -d /private/tmp/cc-plugin-codex-review-smoke.XXXXXX)"
cp "$SMOKE_DIR/calculator.py" "$SMOKE_DIR/test_calculator.py" "$REVIEW_SMOKE_DIR/"
cd "$REVIEW_SMOKE_DIR"
git init
git add calculator.py test_calculator.py
git commit -m "Initial calculator fixture"
perl -0pi -e 's/if b == 0:/if b == "0":/' calculator.py
python -m unittest -v
```

The final unittest command should fail before review; that confirms the seeded
bug exists.

Structured review smoke:

```bash
PLUGIN_CACHE="${CODEX_HOME:-$HOME/.codex}/plugins/cache/personal/cc-plugin-codex/0.1.0"
node "$PLUGIN_CACHE/scripts/claude-companion.mjs" review --cwd "$REVIEW_SMOKE_DIR" --effort low --model sonnet --json
```

Pass criteria:

- Each command exits successfully.
- JSON contains `ok: true` and a completed status where applicable.
- The output includes a Claude session id where the command type supports it.
- `raw.modelUsage`, `stream.modelUsage`, or job `modelUsage` records the actual
  routed Claude model.
- Read-only smokes do not modify fixture files.
- Review smoke reports the seeded issue when using a fixture with a known diff.

## 6. Fresh Codex Skill Smoke

Start a new Codex thread from a throwaway fixture such as `$SMOKE_DIR` after
reinstalling the plugin. Use the user-facing skill path, not raw Node commands:

```text
Use claude-rescue with trusted local dev mode. Fix the failing unittest in this tiny Python calculator project with the smallest correct change, run the tests with python3, and report the result.
```

Pass criteria:

- Codex selects the `cc-plugin-codex:claude-rescue` skill.
- The skill resolves the installed plugin-bundled companion script when the
  target repo does not contain `scripts/claude-companion.mjs`.
- Host approval is requested clearly if needed.
- Claude makes the minimal fix, Codex verifies locally, and the result includes
  actual model usage when available.

## 7. Serious Opus Validation

Run only after explicit approval.

Recommended options:

```bash
--model opus
```

Choose one meaningful task:

- a real rescue task on a nontrivial failing test or bug
- a real structured review on a meaningful PR diff
- an architecture/planning task with `claude-plan`

Pass criteria:

- The command completes without permission, auth, or sandbox confusion.
- The result is useful enough to justify the serious-model pass.
- Actual `modelUsage` is recorded in `context/next-roadmap.md`.
- Any findings or failures are either fixed before release or explicitly logged
  as release blockers.

## 8. Release Decision

Release candidate is ready when:

- Deterministic validation passes.
- Installed-cache validation passes.
- Non-billable setup/status checks are understandable.
- Low-cost real Claude smokes pass.
- Fresh Codex skill smoke passes.
- Serious Opus validation passes or is explicitly deferred.
- README parity matrix has no known pre-RC non-parity gaps.
- Marketplace readiness notes match the intended distribution path.

Record completed validation in `context/next-roadmap.md` under
`RC Validation Log`.

## 9. Version And Tags

Keep the checked-in package and plugin manifest version at `0.1.0` for this
release-candidate line.

After serious Opus validation passes and actual `modelUsage` is recorded:

```bash
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1
```

After RC testing stays clean and the release is promoted:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Do not create release tags before the Opus validation result is logged.
