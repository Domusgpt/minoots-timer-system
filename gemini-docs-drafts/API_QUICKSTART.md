# 🚀 MINOOTS API QUICKSTART

**Get your first timer running with the MINOOTS API.**

---

## 🏁 STEP 1: GET YOUR API KEY

MINOOTS uses API keys for authentication. Currently, API keys are generated within your Firebase project. Please ensure you have set up your Firebase project and authenticated users.

Once a user is authenticated in your Firebase project, an API key can be generated for them. (Details on generating API keys are typically handled via a user dashboard or administrative function within your application built on MINOOTS).

```bash
# Your API key will typically look like this:
mnt_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🏁 STEP 2: CREATE YOUR FIRST TIMER

Timers are created by sending a `POST` request to the `/timers` endpoint.

**Base URL**: `https://api-m3waemr5lq-uc.a.run.app`

### Using cURL (Command Line)
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Timer",
    "duration": "5m",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "Timer completed!"
      }
    }
  }'
```

### Using JavaScript (Node.js)
```javascript
// Install SDK: npm install minoots-sdk
const MinootsSDK = require('minoots-sdk');

const minoots = new MinootsSDK();

const timer = await minoots.createTimer({
  name: 'My First Timer',
  duration: '5m',
  events: {
    on_expire: {
      webhook: 'https://webhook.site/your-unique-url',
      message: 'Timer completed!'
    }
  }
});

console.log('Timer created:', timer);
```

### Using Python
```python
import requests

response = requests.post(
    'https://api-m3waemr5lq-uc.a.run.app/timers',
    headers={
        'x-api-key': 'YOUR_API_KEY',
        'Content-Type': 'application/json'
    },
    json={
        'name': 'My First Timer',
        'duration': '5m',
        'events': {
            'on_expire': {
                'webhook': 'https://webhook.site/your-unique-url',
                'message': 'Timer completed!'
            }
        }
    }
)

timer = response.json()
print('Timer created:', timer);
```

### Successful Response Example
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "My First Timer",
    "duration": 300000,
    "agentId": "sdk_agent",
    "startTime": 1705324200000,
    "endTime": 1705324500000,
    "status": "running",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "Timer completed!"
      }
    },
    "metadata": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "usage": {
    "daily": {
      "used": 1,
      "limit": 5,
      "remaining": 4
    },
    "concurrent": {
      "current": 1,
      "limit": 5,
      "remaining": 4
    }
  }
}
```

---

## 🏁 STEP 3: MONITOR YOUR TIMER

### Get Timer Status
To check the status of a specific timer, use the `GET /timers/{id}` endpoint.

```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/timers/timer_abc123def456 \
  -H "x-api-key: YOUR_API_KEY"
```

### Response Shows Progress
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "My First Timer",
    "agentId": "sdk_agent",
    "duration": 300000,
    "startTime": 1705324200000,
    "endTime": 1705324500000,
    "status": "running",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "Timer completed!"
      }
    },
    "metadata": {},
    "organizationId": "org_example",
    "projectId": "proj_example",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "timeRemaining": 120000,
    "progress": 0.6
  }
}
```

### List All Your Timers
To list all timers accessible by your API key, use the `GET /timers` endpoint.

```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY"
```

---

## 🏁 STEP 4: RECEIVE WEBHOOK NOTIFICATION

When your timer expires, MINOOTS will send an HTTP POST request to the `webhook` URL you provided. The payload will contain information about the expired timer.

```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123def456",
    "name": "My First Timer",
    "agentId": "sdk_agent",
    "duration": 300000,
    "startTime": 1705324200000,
    "endTime": 1705324500000,
    "status": "expired",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "Timer completed!"
      }
    },
    "metadata": {},
    "organizationId": "org_example",
    "projectId": "proj_example",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z"
  },
  "message": "Timer completed!"
}
```

---

## 🔧 DURATION FORMATS

MINOOTS accepts durations in two formats:

*   **Milliseconds (number)**: e.g., `300000` for 5 minutes.
*   **Simple String (number + unit)**: e.g., `"30s"` (seconds), `"5m"` (minutes), `"2h"` (hours), `"1d"` (days).

```javascript
// Examples:
"30s"     // 30 seconds
"90m"     // 90 minutes
"2h"      // 2 hours
"7d"      // 7 days
1800000   // 30 minutes exactly
```

---

## 📊 TIER LIMITS

Your usage is subject to tier-based limits. You can check your current usage via the API.

### Free Tier (Example Limits)
- **5 concurrent timers**
- **5 daily timer creations**
- **Basic webhooks** (fire-and-forget HTTP POST)

### Pro Tier (Example Benefits)
- **Unlimited concurrent timers**
- **Higher daily timer creations**
- **MCP Claude integration**

### Check Your Usage
```bash
curl -X GET https://api-m3waemr5lq-uc.a.run.app/account/usage \
  -H "x-api-key: YOUR_API_KEY"

# Response example:
{
  "success": true,
  "usage": {
    "dailyTimersCreated": 1,
    "concurrentTimers": 1
  },
  "apiKeys": {
    "activeKeys": 1,
    "totalRequests": 5,
    "averageRequestsPerKey": 5
  },
  "tier": "free"
}
```

---

## 🚀 NEXT STEPS

### 1. Install SDK (Optional but Recommended)
```bash
npm install minoots-sdk
```

### 2. AI Agent Integration
If you use Claude or other AI agents, check out our [Claude Integration Guide](./CLAUDE_INTEGRATION.md) for native timer support.

### 3. Team Features
MINOOTS supports organizations and projects for team collaboration. Refer to the [Team Setup Guide](./TEAM_SETUP_GUIDE.md) for more details.

### 4. Read the Full API Reference
Complete endpoint documentation: [API Reference](./API_REFERENCE.md)

---

**🎉 You've created your first MINOOTS timer! Your timer will reliably run in the cloud and notify you exactly when it expires.**

**Questions? Email us at [support@minoots.com](mailto:support@minoots.com)**