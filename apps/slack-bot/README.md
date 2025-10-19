# MINOOTS Slack bot

A Bolt-based Slack application that exposes a `/ato` slash command. Agents and
humans can schedule timers without leaving Slack, and the bot forwards every
request to the MINOOTS control plane with the new multi-region routing hints.

## Running locally

```bash
cp .env.example .env
npm install
npm run dev
```

Configure the slash command in Slack to point at `https://<ngrok>/slack/events`
and supply the signing secret and bot token in the `.env` file. When a user runs:

```
/ato --duration 15m --name "Deploy follow-up" Investigate deployment metrics
```

the bot creates a timer using the configured tenant API key. Extra text after
the options becomes metadata recorded with the timer so that incident channels
have context when the timer fires.
