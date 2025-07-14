# 📚 MINOOTS API REFERENCE

**Complete endpoint documentation for the MINOOTS Timer Infrastructure.**

**Base URL**: `https://api-m3waemr5lq-uc.a.run.app`

---

## 🔐 AUTHENTICATION

### API Key (Recommended)
```http
x-api-key: mnt_live_your_api_key_here
```

### Firebase Token (Web Apps)
```http
Authorization: Bearer your_firebase_id_token
```

---

## 📍 ENDPOINTS

### 🏥 Health Check

#### `GET /health`
Check API status and verify authentication.

**Request**:
```http
GET /health
x-api-key: mnt_live_your_api_key_here
```

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "user": {
    "id": "user_123",
    "tier": "pro",
    "permissions": ["create_timers", "webhooks", "mcp_integration"]
  }
}
```

---

### ⏲️ Timer Operations

#### `POST /timers`
Create a new timer.

**Request**:
```http
POST /timers
x-api-key: mnt_live_your_api_key_here
Content-Type: application/json

{
  "name": "Timer Name",
  "duration": "30m",
  "events": {
    "on_expire": {
      "webhook": "https://yourapp.com/webhook",
      "message": "Timer completed!",
      "data": {
        "key": "value"
      }
    },
    "on_progress": {
      "webhook": "https://yourapp.com/progress",
      "intervals": ["25%", "50%", "75%"]
    }
  },
  "metadata": {
    "priority": "high",
    "tags": ["important", "deadline"]
  }
}
```

**Duration Formats**:
- `"30s"` - 30 seconds
- `"15m"` - 15 minutes  
- `"2h"` - 2 hours
- `"1d"` - 1 day
- `1800000` - milliseconds

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "Timer Name",
    "duration": 1800000,
    "status": "running",
    "progress": 0.0,
    "timeRemaining": 1800000,
    "percentComplete": 0,
    "createdAt": "2024-01-15T10:30:00Z",
    "expiresAt": "2024-01-15T11:00:00Z",
    "events": {
      "on_expire": {
        "webhook": "https://yourapp.com/webhook"
      }
    },
    "metadata": {
      "priority": "high"
    }
  }
}
```

#### `GET /timers`
List all timers for the authenticated user.

**Request**:
```http
GET /timers?status=running&limit=10&offset=0
x-api-key: mnt_live_your_api_key_here
```

**Query Parameters**:
- `status` - Filter by status: `running`, `expired`, `cancelled`
- `limit` - Max results (default: 50, max: 100)
- `offset` - Pagination offset
- `tags` - Filter by metadata tags

**Response**:
```json
{
  "success": true,
  "timers": [
    {
      "id": "timer_abc123",
      "name": "Build Process",
      "status": "running",
      "progress": 0.75,
      "timeRemaining": 450000,
      "expiresAt": "2024-01-15T11:15:00Z"
    }
  ],
  "pagination": {
    "total": 15,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

#### `GET /timers/{timerId}`
Get detailed information about a specific timer.

**Request**:
```http
GET /timers/timer_abc123def456
x-api-key: mnt_live_your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "Build Process",
    "duration": 900000,
    "status": "running",
    "progress": 0.6,
    "timeRemaining": 360000,
    "percentComplete": 60,
    "createdAt": "2024-01-15T10:30:00Z",
    "expiresAt": "2024-01-15T10:45:00Z",
    "events": {
      "on_expire": {
        "webhook": "https://ci.yourcompany.com/build-complete"
      }
    },
    "deliveryStatus": {
      "webhookAttempts": 0,
      "lastDelivery": null,
      "nextRetry": null
    }
  }
}
```

#### `PUT /timers/{timerId}`
Update a timer's properties.

**Request**:
```http
PUT /timers/timer_abc123def456
x-api-key: mnt_live_your_api_key_here
Content-Type: application/json

{
  "name": "Updated Name",
  "events": {
    "on_expire": {
      "webhook": "https://new-webhook.com/updated"
    }
  },
  "metadata": {
    "priority": "critical"
  }
}
```

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "Updated Name",
    "events": {
      "on_expire": {
        "webhook": "https://new-webhook.com/updated"
      }
    }
  }
}
```

#### `DELETE /timers/{timerId}`
Cancel a running timer.

**Request**:
```http
DELETE /timers/timer_abc123def456
x-api-key: mnt_live_your_api_key_here
Content-Type: application/json

{
  "reason": "Build completed successfully"
}
```

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "status": "cancelled",
    "cancelledAt": "2024-01-15T10:40:00Z",
    "reason": "Build completed successfully"
  }
}
```

---

### ⚡ Quick Operations

#### `POST /quick/wait`
Create a simple delay timer without webhooks.

**Request**:
```http
POST /quick/wait
x-api-key: mnt_live_your_api_key_here
Content-Type: application/json

{
  "duration": "5m",
  "message": "Break time over"
}
```

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_quick_xyz789",
    "duration": 300000,
    "status": "running",
    "expiresAt": "2024-01-15T10:35:00Z"
  }
}
```

---

### 👥 Team Operations (Team/Enterprise Tier)

#### `POST /teams/{teamId}/broadcast`
Send notification to team members.

**Request**:
```http
POST /teams/dev-team/broadcast
x-api-key: mnt_live_your_api_key_here
Content-Type: application/json

{
  "message": "Deployment starting in 5 minutes",
  "webhook": "https://slack.com/webhook/dev-team",
  "priority": "high"
}
```

**Response**:
```json
{
  "success": true,
  "broadcast": {
    "id": "broadcast_def456",
    "team": "dev-team",
    "message": "Deployment starting in 5 minutes",
    "sentAt": "2024-01-15T10:30:00Z",
    "recipients": 5
  }
}
```

---

### 📊 Account Operations

#### `GET /account/usage`
Get current usage statistics and limits.

**Request**:
```http
GET /account/usage?days=30
x-api-key: mnt_live_your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "usage": {
    "period": "2024-01-01 to 2024-01-30",
    "timersCreated": 245,
    "activeTimers": 12,
    "webhooksDelivered": 238,
    "apiCalls": 1520
  },
  "limits": {
    "tier": "pro",
    "monthlyTimers": "unlimited",
    "concurrentTimers": "unlimited",
    "webhookRetries": 5,
    "apiCallsPerMinute": 100
  },
  "billing": {
    "nextBillingDate": "2024-02-01",
    "amount": "$19.00",
    "status": "active"
  }
}
```

#### `POST /account/api-keys`
Generate new API key.

**Request**:
```http
POST /account/api-keys
Authorization: Bearer firebase_id_token
Content-Type: application/json

{
  "name": "Production Server Key",
  "permissions": ["create_timers", "webhooks"],
  "expiresAt": "2025-01-15T00:00:00Z"
}
```

**Response**:
```json
{
  "success": true,
  "apiKey": "mnt_live_1234567890abcdef",
  "keyId": "key_abc123",
  "name": "Production Server Key",
  "permissions": ["create_timers", "webhooks"],
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": "2025-01-15T00:00:00Z",
  "warning": "Save this API key - it will not be shown again!"
}
```

#### `GET /account/api-keys`
List existing API keys (keys are masked).

**Request**:
```http
GET /account/api-keys
Authorization: Bearer firebase_id_token
```

**Response**:
```json
{
  "success": true,
  "apiKeys": [
    {
      "keyId": "key_abc123",
      "name": "Production Server Key",
      "keyPreview": "mnt_live_1234...cdef",
      "permissions": ["create_timers", "webhooks"],
      "createdAt": "2024-01-15T10:30:00Z",
      "lastUsed": "2024-01-15T11:25:00Z",
      "status": "active"
    }
  ]
}
```

#### `DELETE /account/api-keys/{keyId}`
Revoke an API key.

**Request**:
```http
DELETE /account/api-keys/key_abc123
Authorization: Bearer firebase_id_token
```

**Response**:
```json
{
  "success": true,
  "message": "API key revoked successfully"
}
```

---

## 🔔 WEBHOOK EVENTS

### Timer Expired Event
Sent when a timer reaches its expiration time.

```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123def456",
    "name": "Build Process",
    "status": "expired",
    "duration": 1800000,
    "createdAt": "2024-01-15T10:30:00Z",
    "expiredAt": "2024-01-15T11:00:00Z"
  },
  "timestamp": "2024-01-15T11:00:00Z",
  "metadata": {
    "apiVersion": "2024-01",
    "source": "minoots-timer-system",
    "customData": {
      "buildId": "build_123"
    }
  }
}
```

### Timer Progress Event
Sent at specified progress intervals.

```json
{
  "event": "timer_progress",
  "timer": {
    "id": "timer_abc123def456",
    "name": "Build Process",
    "status": "running",
    "progress": 0.5,
    "timeRemaining": 900000,
    "percentComplete": 50
  },
  "milestone": "50%",
  "timestamp": "2024-01-15T10:45:00Z"
}
```

### Timer Cancelled Event
Sent when a timer is manually cancelled.

```json
{
  "event": "timer_cancelled",
  "timer": {
    "id": "timer_abc123def456",
    "name": "Build Process",
    "status": "cancelled",
    "cancelledAt": "2024-01-15T10:40:00Z",
    "reason": "Build completed successfully"
  },
  "timestamp": "2024-01-15T10:40:00Z"
}
```

---

## ❌ ERROR RESPONSES

### Standard Error Format
```json
{
  "success": false,
  "error": {
    "code": "INVALID_DURATION",
    "message": "Duration must be between 1 second and 7 days",
    "details": {
      "provided": "10d",
      "maxAllowed": "7d"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Common Error Codes

#### Authentication Errors
- `AUTH_REQUIRED` - No authentication provided
- `INVALID_API_KEY` - API key is invalid or expired
- `INSUFFICIENT_PERMISSIONS` - User lacks required permissions

#### Validation Errors
- `INVALID_DURATION` - Duration format or value is invalid
- `INVALID_WEBHOOK_URL` - Webhook URL is malformed
- `TIMER_NOT_FOUND` - Timer ID doesn't exist
- `INVALID_TIMER_STATUS` - Operation not allowed for timer's current status

#### Rate Limiting Errors
- `RATE_LIMIT_EXCEEDED` - Too many requests per minute
- `TIER_LIMIT_EXCEEDED` - Exceeded tier limits (concurrent timers, monthly quota)
- `QUOTA_EXCEEDED` - Monthly timer limit reached

#### System Errors
- `INTERNAL_ERROR` - Server error (contact support)
- `SERVICE_UNAVAILABLE` - Temporary system maintenance
- `WEBHOOK_DELIVERY_FAILED` - Webhook endpoint unreachable

---

## 📊 RATE LIMITS

### By Tier

| Tier | API Calls/Min | Concurrent Timers | Monthly Timers |
|------|---------------|-------------------|----------------|
| Free | 60 | 5 | 100 |
| Pro | 300 | Unlimited | Unlimited |
| Team | 600 | Unlimited | Unlimited |
| Enterprise | Custom | Unlimited | Unlimited |

### Rate Limit Headers
Every response includes rate limit information:

```http
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 275
X-RateLimit-Reset: 1642248000
X-Tier-Limit-Timers: unlimited
X-Tier-Remaining-Timers: unlimited
```

---

## 🧪 TESTING

### Test Environment
**Base URL**: `https://test-api.minoots.com`

Use test API keys for development:
```
mnt_test_1234567890abcdef
```

### Webhook Testing
Use [webhook.site](https://webhook.site) for testing webhook deliveries:

```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url"
      }
    }
  }'
```

---

## 📚 SDK LIBRARIES

### Official SDKs

#### Node.js
```bash
npm install @minoots/sdk
```

#### Python
```bash
pip install minoots-sdk
```

#### Go
```bash
go get github.com/minoots/go-sdk
```

### Community SDKs
- **PHP**: `composer require minoots/php-sdk`
- **Ruby**: `gem install minoots`
- **Java**: Available on Maven Central

---

## 🔗 USEFUL LINKS

- **Dashboard**: [minoots.com/dashboard](https://minoots.com/dashboard)
- **API Status**: [status.minoots.com](https://status.minoots.com)
- **Support**: [support@minoots.com](mailto:support@minoots.com)
- **Documentation**: [docs.minoots.com](https://docs.minoots.com)
- **GitHub**: [github.com/Domusgpt/minoots-timer-system](https://github.com/Domusgpt/minoots-timer-system)

---

**Questions or issues? Contact our support team at [support@minoots.com](mailto:support@minoots.com)**