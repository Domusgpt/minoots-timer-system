# Minoots Integrations Overview

Phase 6 unlocks secure webhook delivery and first-class integrations so teams can push timer events into their existing tools without bespoke glue code. This guide explains how to configure the Firebase Functions API, SDK helpers, and third-party credentials.

## Webhook Delivery Pipeline

| Feature | Details |
| --- | --- |
| Endpoints | `POST /teams/:teamId/webhooks`, `GET /teams/:teamId/webhooks`, `PATCH /teams/:teamId/webhooks/:webhookId`, `DELETE /teams/:teamId/webhooks/:webhookId` |
| Templates | `POST /teams/:teamId/webhooks/templates/:templateKey` bootstraps Slack/Discord/Teams payloads |
| Retry Engine | Deliveries are queued in `webhook_queue` with exponential backoff (0s → 5 min → 5 min max). The scheduled `processWebhookQueue` Cloud Function drains the queue every minute. |
| Signatures | Each payload includes `x-minoots-signature: t=<unix>,v1=<sha256>` so consumers can verify authenticity. |
| Monitoring | Delivery attempts are stored in `webhook_logs` and available via `GET /teams/:teamId/webhooks/:webhookId/logs?limit=50`. |
| Testing | `POST /teams/:teamId/webhooks/:webhookId/test` publishes a synthetic event; the SDK exposes `triggerWebhookTest(...)`. |

### Environment Variables

| Variable | Purpose |
| --- | --- |
| `WEBHOOK_QUEUE_SCHEDULE` | Cron expression for `processWebhookQueue` (defaults to every minute). |
| `WEBHOOK_DEFAULT_TIMEOUT_MS` | Request timeout for outgoing deliveries (default 10s). |
| `WEBHOOK_MAX_ATTEMPTS` | Maximum retry attempts before an event is dropped (default 5). |

## Integration Types

Use `PUT /teams/:teamId/integrations/:type` or the SDK helper `upsertIntegration(teamId, type, config)` with the following payloads. Secrets are masked in GET responses but stored securely for delivery.

### Slack (`type = "slack"`)
```jsonc
{
  "webhookUrl": "https://hooks.slack.com/services/..."
}
```

### Discord (`type = "discord"`)
```jsonc
{
  "webhookUrl": "https://discord.com/api/webhooks/...",
  "embeds": [/* optional preset embed */]
}
```

### Microsoft Teams (`type = "teams"`)
```jsonc
{
  "webhookUrl": "https://your-domain.webhook.office.com/...",
  "attachments": [/* adaptive card payload */]
}
```

### Telegram (`type = "telegram"`)
```jsonc
{
  "botToken": "123456:ABC",
  "chatId": "-123456",
  "parseMode": "Markdown"
}
```

### Email via SendGrid (`type = "email"`)
```jsonc
{
  "provider": "sendgrid",
  "apiKey": "SG.xxxxxx",
  "from": "no-reply@example.com",
  "to": "alerts@example.com"
}
```

### SMS via Twilio (`type = "sms"`)
```jsonc
{
  "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "authToken": "twilio-auth-token",
  "from": "+15556667777",
  "to": "+15558889999"
}
```

### Voice Calls via Twilio (`type = "voice"`)
```jsonc
{
  "accountSid": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "authToken": "twilio-auth-token",
  "from": "+15556667777",
  "to": "+15550001111"
}
```
The integration generates a `<Response><Say>...</Say></Response>` TwiML payload using the message text.

## SDK Usage

### JavaScript / TypeScript
```ts
const sdk = new MinootsSDK({ apiKey: process.env.MINOOTS_API_KEY, team: 'team-123' });

const { webhook, secret } = await sdk.createWebhook('team-123', {
  url: 'https://example.com/webhook-endpoint',
  events: ['timer.expired']
});

await sdk.upsertIntegration('team-123', 'slack', { webhookUrl: process.env.SLACK_WEBHOOK });
await sdk.publishEvent('team-123', 'timer.completed', { timerId: 'abc123' });
```

### Python
```python
client = AsyncMinootsClient(base_url="https://api.example.com", api_key="key", team="team-123")
await client.create_webhook("team-123", {"url": "https://example.com/hook"})
await client.upsert_integration("team-123", "sms", {
    "accountSid": os.environ["TWILIO_SID"],
    "authToken": os.environ["TWILIO_TOKEN"],
    "from": "+15556667777",
    "to": "+15558889999",
})
await client.publish_event("team-123", "timer.completed", {"timerId": "abc123"})
```

## Testing

- `npm --prefix functions test` exercises webhook queue retries, signature verification, and Twilio form payloads via node:test harnesses.
- `npm --prefix sdk test` validates the JavaScript SDK helpers against a mocked fetch stub.
- `pytest` (from `sdk/python/`) uses respx mocks to cover the Python SDK webhook/integration helpers.

## Next Steps

- Ship Terraform resources for integration secrets to complement the timer module.
- Add automated smoke tests for the VS Code extension and Electron shell once available.
- Extend alerting with automatic retries-to-alert thresholds and Grafana dashboards in Phase 7 analytics work.
