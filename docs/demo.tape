Output docs/demo.gif

Require git
Require node
Require python3

Set Shell "bash"
Set FontSize 24
Set Width 1280
Set Height 720
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 20ms
Set WindowBar Colorful

Hide
Type "bash docs/demo/prepare-review-fixture.sh >/tmp/cc-plugin-codex-demo-dir.txt"
Enter
Type "clear"
Enter
Show

Type "git -C /private/tmp/cc-plugin-codex-demo-review diff -- calculator.py"
Enter
Sleep 2s

Type "codex exec --profile claude-companion --sandbox danger-full-access --cd /private/tmp/cc-plugin-codex-demo-review 'Use claude-review with --model spark and --effort low. Do not use --json. Review the current diff and report the key finding.'"
Enter
Sleep 45s
