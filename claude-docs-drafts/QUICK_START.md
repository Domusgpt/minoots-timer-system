# Quick Start Guide

**Get MINOOTS working in 5 minutes**

## Step 1: Test the API

```bash
curl https://api-m3waemr5lq-uc.a.run.app/health
```

Should return:
```json
{"status": "ok", "timestamp": "2025-01-13T..."}
```

## Step 2: Get an API Key

*Note: API key acquisition process needs to be documented based on actual implementation*

## Step 3: Create Your First Timer

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "30s",
    "name": "My first timer",
    "webhook": "https://webhook.site/your-unique-url"
  }'
```

Response:
```json
{
  "id": "timer_abc123",
  "duration": "30s",
  "name": "My first timer", 
  "status": "running",
  "createdAt": "2025-01-13T23:45:00Z"
}
```

## Step 4: Monitor Your Timer

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/timer_abc123
```

Response shows progress:
```json
{
  "id": "timer_abc123",
  "status": "running",
  "progress": 0.5,
  "timeRemaining": "15s"
}
```

## Step 5: Receive the Webhook

After 30 seconds, your webhook URL receives:
```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123",
    "name": "My first timer",
    "duration": "30s",
    "status": "expired"
  }
}
```

## Common Use Cases

### Rate Limiting
```bash
# Create a 1-minute cooldown timer
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "1m",
    "name": "API cooldown",
    "webhook": "https://your-app.com/api/cooldown-expired"
  }'
```

### Workflow Timeouts
```bash
# Set a 10-minute timeout for a workflow
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "10m",
    "name": "Workflow timeout",
    "webhook": "https://your-app.com/api/workflow-timeout"
  }'
```

### Slack Notifications
```bash
# Send timer completion to Slack
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "1h",
    "name": "Meeting reminder",
    "webhook": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
  }'
```

*Note: You'll need to format the webhook payload for Slack's expected format in your webhook handler*

## Supported Duration Formats

- `30s` - 30 seconds
- `5m` - 5 minutes
- `2h` - 2 hours  
- `1d` - 1 day

*Only single units supported (no complex formats like "1h 30m")*

## Next Steps

- **API Reference** - Complete endpoint documentation
- **SDK Guide** - Use the Node.js SDK
- **MCP Integration** - Use with Claude Desktop
- **Webhooks** - Integration patterns

## Troubleshooting

### Timer not creating
- Check API key is valid
- Verify JSON syntax
- Ensure webhook URL is accessible

### Webhook not received
- Check webhook URL is reachable
- Verify webhook endpoint returns 2xx status
- Test webhook URL independently

### Rate limited
- Wait for rate limit to reset (see Retry-After header)
- Consider upgrading tier for higher limits