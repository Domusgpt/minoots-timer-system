# Webhooks Guide

**Event-driven notifications when timers expire**

## Overview

MINOOTS supports webhooks for timer expiration events only. When a timer expires, MINOOTS sends a POST request to your specified webhook URL.

## Webhook Configuration

When creating a timer, include webhook in the `events.on_expire` object:

```json
{
  "name": "deployment_timer",
  "duration": "10m",
  "events": {
    "on_expire": {
      "webhook": "https://your-app.com/webhook",
      "message": "Deployment timer expired",
      "data": {
        "deploymentId": "dep_123",
        "environment": "production"
      }
    }
  }
}
```

## Webhook Payload

**Verified from index.js lines 168-173**:

```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123",
    "name": "deployment_timer",
    "status": "expired",
    "agentId": "agent_123",
    "duration": 600000,
    "startTime": 1705324200000,
    "endTime": 1705324800000,
    "events": { ... },
    "metadata": { ... }
  },
  "message": "Deployment timer expired",
  "data": {
    "deploymentId": "dep_123",
    "environment": "production"
  }
}
```

## Webhook Behavior

**CRITICAL - Verified from index.js lines 162-179**:

1. **Fire-and-forget**: NO retry logic
2. **No authentication**: Webhooks sent without signatures
3. **Error handling**: Errors logged but don't affect timer
4. **Timeout**: Uses default Node.js fetch timeout
5. **Method**: Always POST
6. **Headers**: Only `Content-Type: application/json`

## Implementation Requirements

Your webhook endpoint must:

1. **Accept POST requests**
2. **Return 2xx status quickly** (no retries on failure)
3. **Handle duplicate calls** (in case of system issues)
4. **Validate source** (no built-in authentication)

## Example Webhook Receiver

```javascript
// Express.js example
app.post('/webhook', (req, res) => {
  const { event, timer, message, data } = req.body;
  
  if (event === 'timer_expired') {
    console.log(`Timer ${timer.name} expired`);
    
    // Process the webhook
    if (data.deploymentId) {
      // Handle deployment completion
    }
  }
  
  // MUST return 2xx quickly
  res.status(200).json({ received: true });
});
```

## Security Considerations

**WARNING**: MINOOTS webhooks have NO built-in security:

1. **No signatures** - Cannot verify webhook source
2. **No authentication** - Anyone can receive webhooks
3. **Public endpoints** - Must be internet accessible

### Recommended Security Measures

```javascript
// 1. Use secret URLs
const webhookUrl = `https://api.example.com/webhook/${process.env.WEBHOOK_SECRET}`;

// 2. Validate timer data
app.post('/webhook/:secret', async (req, res) => {
  if (req.params.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  
  // 3. Verify timer exists in your system
  const { timer } = req.body;
  const knownTimer = await db.get(`timer:${timer.id}`);
  if (!knownTimer) {
    return res.status(404).send('Unknown timer');
  }
  
  // Process webhook...
});
```

## Common Patterns

### Deployment Completion
```javascript
{
  "events": {
    "on_expire": {
      "webhook": "https://ci.company.com/deployment-complete",
      "message": "Deployment window closed",
      "data": { "deploymentId": "dep_123" }
    }
  }
}
```

### Rate Limit Reset
```javascript
{
  "events": {
    "on_expire": {
      "webhook": "https://api.company.com/rate-limit-reset",
      "message": "Rate limit window expired",
      "data": { "userId": "user_456", "endpoint": "/api/process" }
    }
  }
}
```

### Scheduled Tasks
```javascript
{
  "events": {
    "on_expire": {
      "webhook": "https://scheduler.company.com/run-task",
      "message": "Scheduled task ready",
      "data": { "taskId": "task_789", "priority": "high" }
    }
  }
}
```

## Testing Webhooks

Use webhook testing services:
- https://webhook.site
- https://requestbin.com
- ngrok for local testing

Example test:
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "webhook_test",
    "duration": "10s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/YOUR_UNIQUE_URL"
      }
    }
  }'
```

## Limitations

1. **Single event type**: Only `timer_expired` events
2. **No retry logic**: Failed webhooks are not retried
3. **No batch webhooks**: Each timer sends individual webhook
4. **No webhook management**: Cannot update webhook after timer creation
5. **No delivery guarantees**: Best-effort delivery only

---

**Changes from Previous Versions:**
- ✅ **Fire-and-forget behavior**: Clearly documented no retry logic
- ✅ **Security warnings**: Highlighted lack of authentication
- ✅ **Exact payload format**: Verified from actual code
- ✅ **Real limitations**: Based on actual implementation
- ✅ **Practical examples**: Security recommendations added