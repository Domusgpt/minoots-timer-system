# MINOOTS Slack Slash Command (Phase 3 Agent Surface)

This folder contains a minimal Slack slash command integration that allows teams to spin up timers directly from chat while Phase 4 RBAC rolls out.

## Features

- `/ato` command that schedules a MINOOTS timer and reports back when it settles.
- Uses Slack's response URL for asynchronous updates so long waits don't block the command.
- Verifies Slack signing secrets and propagates team identifiers for RBAC-aware scheduling.

## Configuration

1. Create a Slack app with the following scope:
   - `commands`
   - `chat:write`
2. Configure the slash command:
   - Command: `/ato`
   - Request URL: `https://<your-domain>/slack/commands`
3. Set the `SLACK_SIGNING_SECRET` and `MINOOTS_API_KEY` environment variables.
4. Deploy the Express server (see `slash_command.js`) to your preferred hosting provider.

## Usage

```
/ato 25s ship logs
```

The command accepts `duration` followed by an optional timer name or note. The handler maps Slack teams/users to MINOOTS teams so Phase 4 RBAC can enforce collaboration boundaries.

## Phase 4 Roadmap

- Auto-provision MINOOTS teams per Slack workspace.
- Surface upcoming timer expirations in-channel.
- Attach billing insights once Stripe customer IDs are linked to workspaces.
