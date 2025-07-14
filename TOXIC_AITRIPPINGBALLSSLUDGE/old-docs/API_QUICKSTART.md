# 🚀 MINOOTS API QUICKSTART

**Get your first timer running in under 5 minutes.**

---

## 🏁 STEP 1: GET YOUR API KEY

### Create Account
1. Visit [minoots.com/signup](https://minoots.com/signup)
2. Sign up with email/password
3. Verify your email address
4. You're automatically on the **Free tier** (5 concurrent timers, 100/month)

### Generate API Key
1. Go to your [Account Dashboard](https://minoots.com/dashboard)
2. Click **"API Keys"** in the sidebar
3. Click **"Generate New Key"**
4. Name it (e.g., "My App Production Key")
5. **Copy the key immediately** - it's only shown once!

```bash
# Your API key looks like this:
mnt_live_1234567890abcdef1234567890abcdef
```

---

## 🏁 STEP 2: CREATE YOUR FIRST TIMER

### Using cURL (Command Line)
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Timer",
    "duration": "5m",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url"
      }
    }
  }'
```

### Using JavaScript (Node.js)
```javascript
const response = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
  method: 'POST',
  headers: {
    'x-api-key': 'your_api_key_here',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My First Timer',
    duration: '5m',
    events: {
      on_expire: {
        webhook: 'https://webhook.site/your-unique-url'
      }
    }
  })
});

const timer = await response.json();
console.log('Timer created:', timer);
```

### Using Python
```python
import requests

response = requests.post(
    'https://api-m3waemr5lq-uc.a.run.app/timers',
    headers={
        'x-api-key': 'your_api_key_here',
        'Content-Type': 'application/json'
    },
    json={
        'name': 'My First Timer',
        'duration': '5m',
        'events': {
            'on_expire': {
                'webhook': 'https://webhook.site/your-unique-url'
            }
        }
    }
)

timer = response.json()
print('Timer created:', timer)
```

### Response
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "My First Timer",
    "duration": 300000,
    "status": "running",
    "progress": 0.0,
    "timeRemaining": 300000,
    "createdAt": "2024-01-15T10:30:00Z",
    "expiresAt": "2024-01-15T10:35:00Z",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url"
      }
    }
  }
}
```

---

## 🏁 STEP 3: MONITOR YOUR TIMER

### Get Timer Status
```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/timers/timer_abc123def456 \
  -H "x-api-key: your_api_key_here"
```

### Response Shows Progress
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "My First Timer",
    "status": "running",
    "progress": 0.6,
    "timeRemaining": 120000,
    "percentComplete": 60
  }
}
```

### List All Your Timers
```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: your_api_key_here"
```

---

## 🏁 STEP 4: RECEIVE WEBHOOK NOTIFICATION

When your timer expires (after 5 minutes), MINOOTS will POST to your webhook:

```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123def456",
    "name": "My First Timer",
    "status": "expired",
    "duration": 300000
  },
  "timestamp": "2024-01-15T10:35:00Z",
  "metadata": {
    "apiVersion": "2024-01",
    "source": "minoots-timer-system"
  }
}
```

---

## 🎯 COMMON USE CASES

### Build Timeout Timer
```javascript
// 15-minute build timeout with failure webhook
const buildTimer = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Build Process Timeout',
    duration: '15m',
    events: {
      on_expire: {
        webhook: 'https://ci.yourcompany.com/build-timeout',
        data: { buildId: 'build_123', action: 'cancel_build' }
      }
    }
  })
});
```

### Meeting Reminder
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Team Standup Reminder",
    "duration": "1h",
    "events": {
      "on_expire": {
        "webhook": "https://slack.com/api/webhooks/your-webhook",
        "message": "Team standup starting in 5 minutes!"
      }
    }
  }'
```

### Data Processing Monitor
```python
# 2-hour data processing job with progress updates
import requests

timer = requests.post(
    'https://api-m3waemr5lq-uc.a.run.app/timers',
    headers={'x-api-key': api_key, 'Content-Type': 'application/json'},
    json={
        'name': 'Data ETL Process Monitor',
        'duration': '2h',
        'events': {
            'on_expire': {
                'webhook': 'https://analytics.yourcompany.com/etl-timeout',
                'data': {'job_id': 'etl_789', 'max_runtime_exceeded': True}
            },
            'on_progress': {
                'webhook': 'https://analytics.yourcompany.com/etl-progress',
                'intervals': ['25%', '50%', '75%']
            }
        }
    }
)
```

---

## 🔧 DURATION FORMATS

MINOOTS accepts flexible duration formats:

```javascript
// Seconds
"30s"     // 30 seconds
"90s"     // 1.5 minutes

// Minutes  
"15m"     // 15 minutes
"45m"     // 45 minutes

// Hours
"2h"      // 2 hours
"12h"     // 12 hours

// Days
"1d"      // 24 hours
"7d"      // 1 week

// Milliseconds (for precision)
1800000   // 30 minutes exactly
```

---

## 📊 TIER LIMITS

### Free Tier
- **5 concurrent timers**
- **100 timers per month**
- **Basic webhooks** (HTTP POST only)
- **7-day timer history**

### Pro Tier ($19/month)
- **Unlimited timers**
- **Advanced webhooks** (retry logic, custom headers)
- **MCP integration** (Claude agents)
- **90-day history**
- **Priority support**

### Upgrade Anytime
```bash
# Check your current usage
curl -X GET https://api-m3waemr5lq-uc.a.run.app/account/usage \
  -H "x-api-key: your_api_key_here"

# Response shows tier limits and usage
{
  "tier": "free",
  "usage": {
    "timersThisMonth": 45,
    "concurrentTimers": 3,
    "remainingTimers": 55
  },
  "limits": {
    "monthlyTimers": 100,
    "concurrentTimers": 5
  },
  "upgradeUrl": "https://minoots.com/pricing"
}
```

---

## 🚀 NEXT STEPS

### 1. Install SDK (Optional but Recommended)
```bash
npm install @minoots/sdk
```

### 2. AI Agent Integration
If you use Claude or other AI agents, check out our [Claude Integration Guide](./CLAUDE_INTEGRATION.md) for native timer support.

### 3. Team Features
Need multiple users? Upgrade to [Team tier](https://minoots.com/pricing) for collaboration features.

### 4. Read the Full API Reference
Complete endpoint documentation: [API Reference](./API_REFERENCE.md)

---

**🎉 Congratulations! You've created your first MINOOTS timer. Your timer will reliably run in the cloud and notify you exactly when it expires, regardless of crashes or downtime.**

**Questions? Email us at [support@minoots.com](mailto:support@minoots.com)**