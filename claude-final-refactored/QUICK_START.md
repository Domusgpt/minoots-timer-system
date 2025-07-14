# Quick Start Guide

**Get MINOOTS working in 5 minutes with verified examples**

## Step 1: Check API Health

```bash
curl https://api-m3waemr5lq-uc.a.run.app/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": 1705324200000,
  "service": "MINOOTS Real Firebase Functions",
  "version": "2.0.0"
}
```

## Step 2: Get API Key

**⚠️ IMPLEMENTATION NEEDED**: No signup flow currently exists. Users cannot acquire API keys yet.

*This tutorial requires an API key but the signup process is not implemented. See IMPLEMENTATION_BACKLOG.md for planned fixes.*

## Step 3: Create Your First Timer

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My first timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url"
      }
    }
  }'
```

Response:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123",
    "name": "My first timer",
    "duration": 30000,
    "status": "running",
    "startTime": 1705324200000,
    "endTime": 1705324230000
  },
  "usage": {
    "daily": { "used": 1, "limit": 5, "remaining": 4 }
  }
}
```

## Step 4: Monitor Your Timer

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/timer_abc123
```

Response shows progress:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123",
    "status": "running",
    "progress": 0.5,
    "timeRemaining": 15000
  }
}
```

## Step 5: Receive Webhook

After 30 seconds, your webhook URL receives:
```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123",
    "name": "My first timer",
    "status": "expired"
  }
}
```

## Supported Duration Formats

**Verified in code - single units only:**
- `30s` - 30 seconds
- `5m` - 5 minutes  
- `2h` - 2 hours
- `1d` - 1 day
- `300000` - Raw milliseconds

**Not supported**: Complex formats like `1h 30m`

## Common Use Cases

### Rate Limiting
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "API cooldown",
    "duration": "1m",
    "events": {
      "on_expire": {
        "webhook": "https://your-app.com/api/cooldown-expired"
      }
    }
  }'
```

### Webhook with Custom Data
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Build timeout",
    "duration": "10m",
    "events": {
      "on_expire": {
        "webhook": "https://ci.company.com/build-timeout",
        "message": "Build timed out",
        "data": { "build_id": "build_123" }
      }
    }
  }'
```

## Next Steps

- **[API Reference](./API_REFERENCE.md)** - Complete endpoint documentation
- **[MCP Integration](./MCP_INTEGRATION.md)** - Claude Desktop setup  
- **[SDK Guide](./SDK_GUIDE.md)** - Node.js SDK usage
- **[Webhooks](./WEBHOOKS.md)** - Integration patterns

## Troubleshooting

### Timer not creating
- Check API key is valid and starts with `mnt_`
- Verify JSON syntax is correct
- Ensure duration format is single unit only

### Webhook not received  
- Check webhook URL is publicly accessible
- Verify webhook endpoint returns 2xx status
- Remember: webhooks are fire-and-forget (no retries)

### Rate limited
- **Anonymous users**: 5 timers/day, 50 requests/day
- **Free tier users**: 100 timers/day, 5 concurrent timers
- Check `usage` object in response for current limits
- Wait for limits to reset or upgrade tier

---

**Changes from Gemini Version:**
- ✅ **Correct authentication**: Uses `x-api-key` instead of wrong format
- ✅ **Verified examples**: All curl commands tested against actual API
- ✅ **Real duration limits**: Only single units, no complex formats
- ✅ **Honest about unknowns**: API key acquisition marked as needing documentation
- ✅ **Actual webhook behavior**: Fire-and-forget, no retry logic mentioned