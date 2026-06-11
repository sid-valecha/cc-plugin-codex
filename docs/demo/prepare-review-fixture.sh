#!/usr/bin/env bash
set -euo pipefail

DEMO_DIR="${DEMO_DIR:-/private/tmp/cc-plugin-codex-demo-review}"

rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

cat > "$DEMO_DIR/calculator.py" <<'PY'
"""Tiny calculator fixture for the Claude Code Companion demo."""


def add(a, b):
    return a + b


def divide(a, b):
    if b == 0:
        raise ValueError("cannot divide by zero")
    return a / b
PY

cat > "$DEMO_DIR/test_calculator.py" <<'PY'
import unittest

from calculator import add, divide


class CalculatorTests(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_divide_by_zero(self):
        with self.assertRaisesRegex(ValueError, "cannot divide by zero"):
            divide(1, 0)


if __name__ == "__main__":
    unittest.main()
PY

git -C "$DEMO_DIR" init --quiet
git -C "$DEMO_DIR" add calculator.py test_calculator.py
git -C "$DEMO_DIR" commit --quiet -m "Initial calculator fixture"

perl -0pi -e 's/if b == 0:/if b == "0":/' "$DEMO_DIR/calculator.py"

python3 -m compileall -q "$DEMO_DIR"
rm -rf "$DEMO_DIR/__pycache__"

printf '%s\n' "$DEMO_DIR"
