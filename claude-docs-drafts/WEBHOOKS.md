# Webhooks Guide

**Real-time notifications when timers expire**

## Overview

MINOOTS sends webhook notifications when timers expire. This allows your application to react immediately to timer completions without polling.

## How Webhooks Work

1. You create a timer with a `webhook` URL
2. When the timer expires, MINOOTS sends a POST request to your URL
3. Your endpoint receives the timer details and can take action

## Webhook Payload

When a timer expires, your webhook URL receives:

```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123",
    "name": "Timer name",
    "duration": "30s",
    "status": "expired",
    "createdAt": "2025-01-13T23:45:00Z",
    "metadata": {
      "custom": "data"
    }
  }
}
```

## Setting Up Webhooks

### Basic Timer with Webhook

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "1m",
    "name": "Test timer",
    "webhook": "https://your-server.com/webhook/timer-expired"
  }'
```

### Webhook Endpoint Requirements

Your webhook endpoint should:
- Accept POST requests
- Return HTTP 2xx status code (200, 201, 204)
- Respond within 30 seconds
- Handle JSON payload

## Example Webhook Handlers

### Express.js (Node.js)

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhook/timer-expired', (req, res) => {
  const { event, timer } = req.body;
  
  if (event === 'timer_expired') {
    console.log(`Timer ${timer.id} expired: ${timer.name}`);
    
    // Handle the timer expiration
    handleTimerExpired(timer);
  }
  
  // Always return 200 to acknowledge receipt
  res.status(200).send('OK');
});

function handleTimerExpired(timer) {
  // Your business logic here
  console.log('Processing timer expiration:', timer);
}

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

### Python Flask

```python
from flask import Flask, request, jsonify
import logging

app = Flask(__name__)

@app.route('/webhook/timer-expired', methods=['POST'])
def timer_expired():
    data = request.get_json()
    
    if data.get('event') == 'timer_expired':
        timer = data.get('timer', {})
        print(f"Timer {timer.get('id')} expired: {timer.get('name')}")
        
        # Handle the timer expiration
        handle_timer_expired(timer)
    
    return jsonify({'status': 'received'}), 200

def handle_timer_expired(timer):
    # Your business logic here
    print('Processing timer expiration:', timer)

if __name__ == '__main__':
    app.run(port=3000)
```

## Platform Integration Examples

### Slack Notifications

To send notifications to Slack, your webhook handler needs to format the message:

```javascript
app.post('/webhook/timer-expired', async (req, res) => {
  const { timer } = req.body;
  
  // Format message for Slack
  const slackMessage = {
    text: `⏰ Timer "${timer.name}" has expired`,
    attachments: [{
      color: 'warning',
      fields: [{
        title: 'Duration',
        value: timer.duration,
        short: true
      }, {
        title: 'Created',
        value: timer.createdAt,
        short: true
      }]
    }]
  };
  
  // Send to Slack webhook
  await fetch('https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slackMessage)
  });
  
  res.status(200).send('OK');
});
```

### Discord Notifications

```javascript
app.post('/webhook/timer-expired', async (req, res) => {
  const { timer } = req.body;
  
  // Format message for Discord
  const discordMessage = {
    content: `⏰ Timer "${timer.name}" has expired!`,
    embeds: [{
      title: 'Timer Details',
      fields: [
        { name: 'Duration', value: timer.duration, inline: true },
        { name: 'Status', value: timer.status, inline: true }
      ],
      color: 16776960 // Yellow
    }]
  };
  
  // Send to Discord webhook
  await fetch('https://discord.com/api/webhooks/YOUR_WEBHOOK_URL', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(discordMessage)
  });
  
  res.status(200).send('OK');
});
```

## Common Patterns

### Workflow Coordination

```javascript
app.post('/webhook/timer-expired', (req, res) => {
  const { timer } = req.body;
  
  if (timer.metadata?.type === 'workflow_step') {
    const { workflowId, step } = timer.metadata;
    
    // Trigger next step in workflow
    triggerNextWorkflowStep(workflowId, step + 1);
  }
  
  res.status(200).send('OK');
});
```

### Rate Limit Recovery

```javascript
app.post('/webhook/timer-expired', (req, res) => {
  const { timer } = req.body;
  
  if (timer.metadata?.type === 'rate_limit') {
    const { apiEndpoint } = timer.metadata;
    
    // Re-enable API endpoint
    enableAPIEndpoint(apiEndpoint);
  }
  
  res.status(200).send('OK');
});
```

### Timeout Handling

```javascript
app.post('/webhook/timer-expired', (req, res) => {
  const { timer } = req.body;
  
  if (timer.metadata?.type === 'timeout') {
    const { operationId } = timer.metadata;
    
    // Cancel the timed-out operation
    cancelOperation(operationId);
  }
  
  res.status(200).send('OK');
});
```

## Testing Webhooks

### Using webhook.site

For testing, you can use https://webhook.site to get a temporary webhook URL:

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "10s",
    "name": "Test webhook",
    "webhook": "https://webhook.site/your-unique-id"
  }'
```

### Local Testing with ngrok

To test with your local development server:

1. Install ngrok: `npm install -g ngrok`
2. Start your local server: `node server.js`
3. Expose it: `ngrok http 3000`
4. Use the ngrok URL as your webhook

## Webhook Limitations

### Current Limitations
- **No retry logic** - Failed webhooks are not retried
- **No signature verification** - No built-in security headers
- **Single webhook per timer** - Can't send to multiple URLs
- **30-second timeout** - Webhook must respond quickly
- **Fire-and-forget** - No delivery confirmation

### Workarounds
- Implement your own retry logic in the webhook handler
- Use a queue system for reliable processing
- Set up monitoring to track webhook delivery
- Keep webhook handlers lightweight and fast

## Troubleshooting

### Webhook not received
- Check webhook URL is publicly accessible
- Verify endpoint returns 2xx status code
- Test endpoint independently with curl
- Check server logs for errors

### Webhook timing out
- Optimize webhook handler performance
- Move heavy processing to background jobs
- Return 200 status immediately, process async

### Testing webhook locally
- Use ngrok or similar tool to expose local server
- Check firewall settings
- Verify webhook URL in timer creation response