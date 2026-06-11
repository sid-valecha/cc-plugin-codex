# Marketplace Readiness

This plugin is currently ready for public Git-backed marketplace installation,
personal/local installation, and workspace testing. Public OpenAI Plugin
Directory submission is still deferred until self-serve publishing is available.

## Recommendation

Use these distribution paths in order:

1. Public Git-backed marketplace for normal OSS install.
2. Personal/local marketplace while developing and validating release-candidate
   behavior.
3. Repo/team marketplace when another developer should install the plugin from a
   shared Git source or curated internal plugin catalog.
4. Workspace sharing from the Codex app when selected teammates should install
   the plugin through the UI.
5. Public OpenAI Plugin Directory only after public self-serve publishing is
   available and the plugin is release-candidate stable.

Do not add an MCP server just to call Claude Code. The current plugin shape is
Codex skills plus a deterministic local Node entry point. MCP should be added
only if the plugin needs structured tools, a persistent service, shared remote
state, or integrations such as Figma/browser/developer-tool access.

## Public Git-Backed Install

The `marketplace` branch is a Codex marketplace root with this layout:

```text
.agents/plugins/marketplace.json
plugins/cc-plugin-codex/
```

Install it with:

```bash
codex plugin marketplace add sid-valecha/cc-plugin-codex --ref marketplace
codex plugin add cc-plugin-codex@claude-code-companion
```

Start a new Codex thread after installing so skill metadata is loaded.

## Personal Install

Personal install is for the plugin author or a single local developer.

Codex discovers the default personal marketplace at:

```text
~/.agents/plugins/marketplace.json
```

A marketplace entry should point at a plugin checkout relative to the
marketplace root:

```json
{
  "name": "cc-plugin-codex",
  "source": {
    "source": "local",
    "path": "./plugins/cc-plugin-codex"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

For the default personal marketplace, `./plugins/cc-plugin-codex` resolves to:

```text
~/plugins/cc-plugin-codex
```

Install or reinstall with:

```bash
codex plugin add cc-plugin-codex@personal
```

If the personal marketplace has a different top-level name, read it first:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/read_marketplace_name.py"
```

Then reinstall with:

```bash
codex plugin add cc-plugin-codex@<marketplace-name>
```

When iterating on the same local install, update the manifest cachebuster before
reinstalling:

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py" .
codex plugin add cc-plugin-codex@<marketplace-name>
```

Start a new Codex thread after reinstalling so skill metadata is reloaded.

## Repo/Team Marketplace Layout

Repo/team marketplace packaging should use a parent marketplace root. Do not
assume this plugin repository can be used as both the marketplace root and the
plugin root unless the marketplace source path has been validated explicitly.
Use `templates/team-marketplace/` as the copyable starting point.

Recommended layout:

```text
team-codex-marketplace/
  .agents/
    plugins/
      marketplace.json
  plugins/
    cc-plugin-codex/
      .codex-plugin/
        plugin.json
      skills/
      scripts/
      hooks/
      README.md
```

`team-codex-marketplace/.agents/plugins/marketplace.json`:

```json
{
  "name": "team-codex",
  "interface": {
    "displayName": "Team Codex Plugins"
  },
  "plugins": [
    {
      "name": "cc-plugin-codex",
      "source": {
        "source": "local",
        "path": "./plugins/cc-plugin-codex"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

Install the marketplace from a local checkout:

```bash
codex plugin marketplace add /absolute/path/to/team-codex-marketplace
codex plugin marketplace list
codex plugin add cc-plugin-codex@team-codex
```

Install the marketplace from Git:

```bash
codex plugin marketplace add owner/team-codex-marketplace --ref main
codex plugin marketplace list
codex plugin add cc-plugin-codex@team-codex
```

Use `codex plugin marketplace upgrade team-codex` after the marketplace source
changes.

## User Versus Agent Responsibilities

Users should normally ask Codex to use plugin skills, not run the Node script by
hand. Raw `node scripts/claude-companion.mjs ...` commands are for validation,
debugging, and CI-like local checks.

User-owned one-time setup:

- Install Claude Code.
- Log in with `claude auth login --claudeai` or configure bare-compatible auth.
- Install or reinstall the Codex plugin from the chosen marketplace.
- Start a new Codex thread after install/reinstall.
- Approve narrow Claude-invoking command prefixes when Codex asks.

Agent-owned normal workflow:

- Select `claude-setup`, `claude-rescue`, `claude-plan`, `claude-ui`,
  `claude-review`, or job-management skills based on the user's request.
- Run plugin commands through the checked-in Node entry point.
- Surface setup/auth/permission failures immediately with the next fix.
- Report Claude `modelUsage` when real Claude output includes it.

## First-Run Validation

These checks do not send prompts to Claude:

```bash
npm test
node --check scripts/claude-companion.mjs
python "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/validate_plugin.py" .
node scripts/claude-companion.mjs setup --json
node scripts/claude-companion.mjs status --limit 5
```

These checks send prompts or diffs to Claude and may spend quota. Run them only
after explicit user approval in a Codex environment whose host policy allows
external disclosure:

```bash
node scripts/claude-companion.mjs plan --prompt "Smoke test only. Reply with exactly OK." --effort low --model sonnet --json
node scripts/claude-companion.mjs ui --prompt "Smoke test only. Reply with exactly OK." --plan --effort low --model sonnet --json
node scripts/claude-companion.mjs rescue --prompt "Reply with OK only" --background --wait --effort low --model sonnet --json
node scripts/claude-companion.mjs review --effort low --model sonnet --json
```

If Codex blocks these calls under external-disclosure policy, the plugin must
not bypass that policy. Ask the user or workspace admin to allow the narrow
plugin command prefixes, then retry.
