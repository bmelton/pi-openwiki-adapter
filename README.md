# pi-openwiki-adapter

Pi package exposing generated OpenWiki documentation to Pi Coding Agent as token-efficient codebase navigation tools.

This package is intentionally a thin wrapper around the published `openwiki` CLI and generated `openwiki/` Markdown directory. It does not generate documentation unless the user explicitly runs `/openwiki update`.

## Install OpenWiki

```bash
npm install -g openwiki
```

Then initialize docs in a repository:

```bash
cd /path/to/repo
openwiki --init
```

## Install this Pi package

```bash
pi install npm:pi-openwiki-adapter

# or, from a local checkout
pi install /path/to/pi-openwiki-adapter
```

## Tools

- `openwiki_status`
- `openwiki_outline`
- `openwiki_search`
- `openwiki_read`
- `openwiki_update_suggestion`

Tools are enabled only when the current Pi session already has codebase lookup capability (`read`, `grep`, `find`, or `ls`).

## Slash command

Use `/openwiki <subcommand>`:

- `doctor` - status, wiki directory, freshness, capability gate
- `setup` - interactive freshness policy setup
- `update` - confirms, then runs `openwiki --update --print`
- `install` - shows install guidance
- `enable` / `disable` - toggles project config

## Configuration

Project config lives at `.pi/openwiki.json`.

```json
{
  "enabled": true,
  "openwiki": {
    "command": "openwiki",
    "cwd": ".",
    "timeoutMs": 1800000
  },
  "freshness": {
    "managedBy": "manual",
    "nudge": true,
    "significantFileThreshold": 10
  }
}
```

A global config at `~/.pi/agent/openwiki.json` uses the same shape. Project values win.

## Freshness

Freshness nudges are advisory. The package reads the local `openwiki/` directory plus git drift signals. It never updates OpenWiki automatically.

Set `freshness.nudge` to `false` to silence the session-start notice. `/openwiki doctor` still reports drift.
