# MINOOTS Timer Assistant (VS Code)

This extension bootstraps a lightweight command palette interface for the MINOOTS timer platform.

## Features

- `MINOOTS: Create Timer` prompts for name/duration and schedules a timer using the configured API key and team.
- `MINOOTS: Open Dashboard` opens the hosted dashboard in your default browser.

## Configuration

Set the following workspace or user settings:

- `minoots.apiKey` – API key used to authenticate.
- `minoots.team` – Default team ID for timer creation.
- `minoots.apiBase` – Override the API base URL (defaults to production).

## Development

```bash
cd tools/vscode-minoots
npm install
npm run compile
```

Use the VS Code “Run Extension” launch config to debug.
