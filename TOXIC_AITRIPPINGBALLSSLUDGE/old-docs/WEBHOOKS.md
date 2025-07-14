# 🔔 WEBHOOK INTEGRATION GUIDE

**Receive real-time notifications when your timers expire or reach milestones.**

## 🚀 QUICK START

### Basic Webhook Setup
```javascript
const timer = await minoots.timers.create({
  name: 'Build Process',
  duration: '15m',
  events: {
    on_expire: {
      webhook: 'https://your-app.com/timer-complete',
      message: 'Build process completed!',
      data: { buildId: '123', environment: 'production' }
    }
  }
});
```

### Webhook Payload
When your timer expires, MINOOTS will POST:
```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123",
    "name": "Build Process",
    "status": "expired",
    "duration": 900000,
    "createdAt": "2024-01-15T10:00:00Z",
    "expiredAt": "2024-01-15T10:15:00Z"
  },
  "message": "Build process completed!",
  "data": {
    "buildId": "123",
    "environment": "production"
  },
  "timestamp": "2024-01-15T10:15:00Z"
}
```

## 🎯 WEBHOOK TYPES

### Timer Expiration
```javascript
{
  events: {
    on_expire: {
      webhook: 'https://your-app.com/timer-done',
      message: 'Timer completed!',
      data: { customField: 'value' }
    }
  }
}
```

### Progress Milestones
```javascript
{
  events: {
    on_progress: {
      webhook: 'https://your-app.com/progress',
      intervals: ['25%', '50%', '75%']
    }
  }
}
```

### Timer Cancellation
```javascript
// When timer is cancelled, webhook receives:
{
  "event": "timer_cancelled",
  "timer": {
    "id": "timer_abc123",
    "status": "cancelled",
    "reason": "Build completed early"
  }
}
```

## 🔒 WEBHOOK SECURITY

### Signature Verification
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
    
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expectedSignature}`),
    Buffer.from(signature)
  );
}

// Express.js webhook handler
app.post('/minoots-webhook', express.raw({type: 'application/json'}), (req, res) => {
  const signature = req.headers['x-minoots-signature'];
  const payload = req.body;
  
  if (!verifyWebhookSignature(payload, signature, WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  const event = JSON.parse(payload);
  handleTimerEvent(event);
  res.status(200).send('OK');
});
```

## 🔄 RETRY LOGIC

### MINOOTS Retry Policy
- **Initial attempt**: Immediate
- **Retry 1**: After 5 seconds
- **Retry 2**: After 25 seconds  
- **Retry 3**: After 125 seconds
- **Final attempt**: After 625 seconds

### Webhook Response Requirements
```javascript
// Your webhook should respond with 2xx status
app.post('/webhook', (req, res) => {
  try {
    processTimerEvent(req.body);
    res.status(200).send('OK'); // Success
  } catch (error) {
    console.error('Webhook processing failed:', error);
    res.status(500).send('Processing failed'); // Will be retried
  }
});
```

## 📱 PLATFORM INTEGRATIONS

### Slack Integration
```javascript
const timer = await minoots.timers.create({
  name: 'Sprint Planning',
  duration: '2h',
  events: {
    on_expire: {
      webhook: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
      message: 'Sprint planning session completed!',
      data: {
        channel: '#dev-team',
        username: 'MINOOTS Bot'
      }
    }
  }
});
```

### Discord Integration
```javascript
const discordWebhook = {
  webhook: 'https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK',
  message: 'Deployment window closing in 10 minutes',
  data: {
    embeds: [{
      title: 'MINOOTS Timer Alert',
      color: 0xff6b35,
      description: 'Deployment window closing soon'
    }]
  }
};
```

### Email Notifications (via Webhook Service)
```javascript
const emailNotification = {
  webhook: 'https://your-email-service.com/send',
  data: {
    to: 'team@company.com',
    subject: 'Timer Alert: Build Process Complete',
    template: 'timer-completion',
    variables: {
      timerName: 'Build Process',
      duration: '15 minutes',
      completedAt: new Date().toISOString()
    }
  }
};
```

## 🧪 TESTING WEBHOOKS

### Using webhook.site
```javascript
// Test with webhook.site for development
const testTimer = await minoots.timers.create({
  name: 'Webhook Test',
  duration: '30s',
  events: {
    on_expire: {
      webhook: 'https://webhook.site/your-unique-url'
    }
  }
});
```

### Local Testing with ngrok
```bash
# Expose local server for webhook testing
npm install -g ngrok
ngrok http 3000

# Use the ngrok URL in your webhook
# https://abc123.ngrok.io/webhook
```

### Testing Framework
```javascript
const request = require('supertest');
const app = require('./app');

describe('Webhook Handler', () => {
  test('handles timer expiration', async () => {
    const mockEvent = {
      event: 'timer_expired',
      timer: { id: 'test', name: 'Test Timer' }
    };
    
    const response = await request(app)
      .post('/webhook')
      .send(mockEvent)
      .expect(200);
  });
});
```

## 🎛️ ADVANCED PATTERNS

### Conditional Webhooks
```javascript
const timer = await minoots.timers.create({
  name: 'Build with Conditions',
  duration: '10m',
  events: {
    on_expire: {
      webhook: 'https://your-app.com/conditional-webhook',
      data: {
        conditions: {
          if_tests_pass: 'https://deploy.com/production',
          if_tests_fail: 'https://notify.com/build-failed'
        }
      }
    }
  }
});
```

### Webhook Chaining
```javascript
// Chain multiple operations via webhooks
const startWorkflow = async () => {
  // Step 1: Build
  await minoots.timers.create({
    name: 'Build Step',
    duration: '5m',
    events: {
      on_expire: {
        webhook: 'https://your-app.com/start-tests',
        data: { nextStep: 'testing' }
      }
    }
  });
};

// Webhook handler starts next step
app.post('/start-tests', (req, res) => {
  // Step 2: Testing
  minoots.timers.create({
    name: 'Test Step',
    duration: '10m',
    events: {
      on_expire: {
        webhook: 'https://your-app.com/start-deploy',
        data: { nextStep: 'deployment' }
      }
    }
  });
  
  res.status(200).send('Tests started');
});
```

## 📊 WEBHOOK MONITORING

### Tracking Webhook Delivery
```javascript
// Monitor webhook success/failure rates
app.post('/webhook-stats', (req, res) => {
  const event = req.body;
  
  // Log webhook delivery
  console.log({
    event: event.event,
    timerId: event.timer.id,
    deliveredAt: new Date(),
    attempt: req.headers['x-minoots-attempt'] || 1
  });
  
  res.status(200).send('OK');
});
```

### Health Check Endpoint
```javascript
// Webhook health check for MINOOTS monitoring
app.get('/webhook-health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    lastWebhookReceived: getLastWebhookTime()
  });
});
```