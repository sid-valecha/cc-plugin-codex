# Team Marketplace Template

This directory is a copyable parent marketplace root for sharing
`cc-plugin-codex` with a team or another local developer.

Expected layout after copying the plugin into the template:

```text
team-marketplace/
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

From a local checkout:

```bash
mkdir -p team-marketplace/plugins
cp -R /path/to/cc-plugin-codex team-marketplace/plugins/cc-plugin-codex
codex plugin marketplace add /absolute/path/to/team-marketplace
codex plugin marketplace list
codex plugin add cc-plugin-codex@team-codex
```

From a Git marketplace repository:

```bash
codex plugin marketplace add owner/team-marketplace --ref main
codex plugin marketplace list
codex plugin add cc-plugin-codex@team-codex
```

When the marketplace source changes:

```bash
codex plugin marketplace upgrade team-codex
codex plugin add cc-plugin-codex@team-codex
```

Start a new Codex thread after install or reinstall so skill metadata is
reloaded.

Users should normally ask Codex to use skills such as `claude-setup`,
`claude-rescue`, `claude-plan`, `claude-ui`, and `claude-review`; raw Node
commands are for validation and debugging.
