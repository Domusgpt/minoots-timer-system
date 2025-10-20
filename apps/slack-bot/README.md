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

### Ecosystem flags

Pass structured JSON snippets to weave timers into the broader Clear Seas Solutions ecosystem:

```text
/ato --duration 30m --parserator '{"workspaceId":"parserator-west","datasetId":"contacts-v3"}' \
     --reposiologist '{"repositoryUrl":"https://github.com/domusgpt/minoots-timer-system","sweepCadence":"weekly"}' \
     --nimbus '{"policyId":"guardian-prod-gate","environment":"production"}' \
     --clear-seas '{"engagementId":"cse-beta","serviceTier":"pilot"}' \
     --ecosystem-narrative "Parse → Plan → Ship follow-up for beta cohort"
```

The bot merges these payloads into the new `ecosystem` field, so downstream analytics can correlate MINOOTS timers with Parserator ingestion clinics, Reposiologist Clause Code sweeps, Nimbus Guardian guardrails, and Clear Seas Solutions client pods.
