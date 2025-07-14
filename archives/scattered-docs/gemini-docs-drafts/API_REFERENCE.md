# 📚 MINOOTS API REFERENCE

**Complete endpoint documentation for the MINOOTS Timer Infrastructure.**

**Base URL**: `https://api-m3waemr5lq-uc.a.run.app`

---

## 🔐 AUTHENTICATION

MINOOTS API uses API Key authentication. Your API key should be sent in the `x-api-key` HTTP header.

```http
x-api-key: your_api_key_here
```

---

## 📍 ENDPOINTS

### 🏥 Health Check

#### `GET /health`
Check API status.

**Request**:
```http
GET /health
```

**Response**:
```json
{
  "status": "healthy",
  "timestamp": 1705324200000,
  "service": "MINOOTS Real Firebase Functions",
  "version": "2.0.0",
  "features": {
    "authentication": true,
    "rateLimiting": true,
    "usageTracking": true,
    "mcpIntegration": true
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
x-api-key: your_api_key_here
Content-Type: application/json

{
  "name": "My New Timer",
  "duration": "30s",
  "agent_id": "optional_agent_identifier",
  "organizationId": "optional_organization_id",
  "projectId": "optional_project_id",
  "events": {
    "on_expire": {
      "webhook": "https://your-app.com/webhook-endpoint",
      "message": "Optional message for webhook payload",
      "data": {
        "customKey": "customValue"
      }
    }
  },
  "metadata": {
    "customMetadataKey": "customMetadataValue"
  }
}
```

**Duration Formats**:
- `"30s"` - 30 seconds
- `"15m"` - 15 minutes  
- `"2h"` - 2 hours
- `"1d"` - 1 day
- `1800000` - milliseconds (number)

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "My New Timer",
    "agentId": "optional_agent_identifier",
    "duration": 30000,
    "startTime": 1705324200000,
    "endTime": 1705324230000,
    "status": "running",
    "events": {
      "on_expire": {
        "webhook": "https://your-app.com/webhook-endpoint",
        "message": "Optional message for webhook payload",
        "data": {
          "customKey": "customValue"
        }
      }
    },
    "metadata": {
      "customMetadataKey": "customMetadataValue",
      "createdBy": "user_firebase_uid",
      "userTier": "free",
      "permissionSource": "custom_claims"
    },
    "organizationId": "optional_organization_id",
    "projectId": "optional_project_id",
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

#### `GET /timers`
List timers accessible by the authenticated user. Filters can be applied.

**Request**:
```http
GET /timers?agent_id=your_agent_id&status=running&organizationId=your_org_id
x-api-key: your_api_key_here
```

**Query Parameters**:
- `agent_id` - Filter by the agent ID that created the timer.
- `team` - Filter by team name.
- `status` - Filter by timer status: `running`, `expired`.
- `organizationId` - Filter by organization ID.
- `projectId` - Filter by project ID.

**Response**:
```json
{
  "success": true,
  "timers": [
    {
      "id": "timer_abc123",
      "name": "Build Process",
      "agentId": "your_agent_id",
      "duration": 900000,
      "startTime": 1705324200000,
      "endTime": 1705325100000,
      "status": "running",
      "events": {},
      "metadata": {},
      "organizationId": "your_org_id",
      "projectId": "your_project_id",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "timeRemaining": 450000,
      "progress": 0.5
    }
  ],
  "count": 1
}
```

#### `GET /timers/{timerId}`
Get detailed information about a specific timer.

**Request**:
```http
GET /timers/timer_abc123def456
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_abc123def456",
    "name": "Build Process",
    "agentId": "your_agent_id",
    "duration": 900000,
    "startTime": 1705324200000,
    "endTime": 1705325100000,
    "status": "running",
    "events": {
      "on_expire": {
        "webhook": "https://ci.yourcompany.com/build-complete"
      }
    },
    "metadata": {
      "createdBy": "user_firebase_uid",
      "userTier": "pro",
      "permissionSource": "custom_claims"
    },
    "organizationId": "your_org_id",
    "projectId": "your_project_id",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "timeRemaining": 360000,
    "progress": 0.6
  }
}
```

#### `DELETE /timers/{timerId}`
Delete a timer. This will stop a running timer and remove it from the system.

**Request**:
```http
DELETE /timers/timer_abc123def456
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true
}
```

---

### ⚡ Quick Operations

#### `POST /quick/wait`
Create a simple delay timer. This timer does not support webhooks or complex events.

**Request**:
```http
POST /quick/wait
x-api-key: your_api_key_here
Content-Type: application/json

{
  "duration": "5m",
  "name": "Optional name for the wait timer",
  "agent_id": "optional_agent_identifier"
}
```

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_quick_xyz789",
    "name": "Optional name for the wait timer",
    "agentId": "optional_agent_identifier",
    "duration": 300000,
    "startTime": 1705324200000,
    "endTime": 1705324500000,
    "status": "running",
    "events": {},
    "metadata": {
      "createdBy": "user_firebase_uid",
      "userTier": "free",
      "permissionSource": "custom_claims"
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

### 👥 Team Operations

#### `POST /organizations`
Create a new organization. The creating user is automatically assigned the 'owner' role.

**Request**:
```http
POST /organizations
x-api-key: your_api_key_here
Content-Type: application/json

{
  "name": "My New Organization",
  "slug": "my-new-org" 
}
```

**Response**:
```json
{
  "success": true,
  "organization": {
    "id": "org_abc123",
    "name": "My New Organization",
    "slug": "my-new-org",
    "members": {
      "user_firebase_uid": "owner"
    },
    "projects": [],
    "settings": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "message": "Organization created successfully"
}
```

#### `GET /organizations`
List organizations the authenticated user is a member of.

**Request**:
```http
GET /organizations
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "organizations": [
    {
      "id": "org_abc123",
      "role": "owner",
      "name": "My New Organization",
      "slug": "my-new-org",
      "members": {},
      "projects": [],
      "settings": {},
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "count": 1
}
```

#### `GET /organizations/{orgId}`
Get details of a specific organization.

**Request**:
```http
GET /organizations/org_abc123
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "organization": {
    "id": "org_abc123",
    "userRole": "owner",
    "name": "My New Organization",
    "slug": "my-new-org",
    "members": {},
    "projects": [],
    "settings": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

#### `POST /organizations/{orgId}/invite`
Invite a user to an organization with a specific role. Requires `admin` or `owner` role in the organization.

**Request**:
```http
POST /organizations/org_abc123/invite
x-api-key: your_api_key_here
Content-Type: application/json

{
  "email": "new_member@example.com",
  "role": "editor"
}
```

**Response**:
```json
{
  "success": true,
  "invitation": {
    "id": "inv_xyz789",
    "organizationId": "org_abc123",
    "email": "new_member@example.com",
    "role": "editor",
    "invitedBy": "user_firebase_uid",
    "status": "pending",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  "message": "User invitation sent successfully"
}
```

#### `POST /organizations/{orgId}/projects`
Create a new project within an organization. Requires `manager` role or higher in the organization.

**Request**:
```http
POST /organizations/org_abc123/projects
x-api-key: your_api_key_here
Content-Type: application/json

{
  "name": "My New Project",
  "description": "Optional project description"
}
```

**Response**:
```json
{
  "success": true,
  "project": {
    "id": "proj_xyz789",
    "name": "My New Project",
    "description": "Optional project description",
    "organizationId": "org_abc123",
    "access": {
      "user_firebase_uid": "owner"
    },
    "timers": [],
    "settings": {},
    "metadata": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "message": "Project created successfully"
}
```

#### `GET /organizations/{orgId}/projects`
List projects within a specific organization.

**Request**:
```http
GET /organizations/org_abc123/projects
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "projects": [
    {
      "id": "proj_xyz789",
      "name": "My New Project",
      "description": "Optional project description",
      "organizationId": "org_abc123",
      "access": {},
      "timers": [],
      "settings": {},
      "metadata": {},
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /teams/{teamName}/broadcast`
Send a message to all members of a specific team. This is a basic notification mechanism.

**Request**:
```http
POST /teams/dev-team/broadcast
x-api-key: your_api_key_here
Content-Type: application/json

{
  "message": "Deployment starting in 5 minutes",
  "data": {
    "customKey": "customValue"
  }
}
```

**Response**:
```json
{
  "success": true,
  "broadcast": {
    "team": "dev-team",
    "message": "Deployment starting in 5 minutes",
    "data": {
      "customKey": "customValue"
    },
    "timestamp": 1705324200000
  }
}
```

---

### 📊 Account Operations

#### `GET /account/usage`
Get current usage statistics and tier information for the authenticated user.

**Request**:
```http
GET /account/usage
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "usage": {
    "dailyTimersCreated": 5,
    "concurrentTimers": 3
  },
  "apiKeys": {
    "activeKeys": 2,
    "totalRequests": 150,
    "averageRequestsPerKey": 75
  },
  "tier": "free"
}
```

#### `POST /account/api-keys`
Generate a new API key for the authenticated user.

**Request**:
```http
POST /account/api-keys
x-api-key: your_api_key_here
Content-Type: application/json

{
  "name": "My New API Key"
}
```

**Response**:
```json
{
  "success": true,
  "apiKey": "mnt_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "name": "My New API Key",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "warning": "Save this API key - it will not be shown again!"
}
```

#### `GET /account/api-keys`
List existing API keys for the authenticated user. Keys are masked for security.

**Request**:
```http
GET /account/api-keys
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "apiKeys": [
    {
      "id": "key_abc123",
      "name": "My New API Key",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "lastUsed": "2024-01-15T11:25:00.000Z",
      "totalRequests": 150,
      "keyPreview": "mnt_live_xxxx...xxxx"
    }
  ]
}
```

#### `DELETE /account/api-keys/{keyId}`
Revoke an API key. The key will no longer be valid for authentication.

**Request**:
```http
DELETE /account/api-keys/key_abc123
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "message": "API key revoked successfully"
}
```

#### `PUT /account/api-keys/{keyId}`
Update the name of an API key.

**Request**:
```http
PUT /account/api-keys/key_abc123
x-api-key: your_api_key_here
Content-Type: application/json

{
  "name": "Updated Key Name"
}
```

**Response**:
```json
{
  "success": true,
  "message": "API key updated successfully"
}
```

---

### 💰 Billing Operations

#### `GET /pricing`
Get information about available pricing tiers and their features.

**Request**:
```http
GET /pricing
```

**Response**:
```json
{
  "success": true,
  "tiers": {
    "free": {
      "price": 0,
      "name": "Free",
      "features": [
        "5 concurrent timers",
        "100 timers per month",
        "Basic webhooks",
        "7 day history"
      ]
    },
    "pro": {
      "price": 19,
      "name": "Pro",
      "monthly": "price_123monthly",
      "yearly": "price_123yearly",
      "features": [
        "Unlimited timers",
        "MCP Claude integration",
        "Token reset scheduling",
        "Advanced webhooks",
        "90 day history",
        "Priority support"
      ]
    },
    "team": {
      "price": 49,
      "name": "Team",
      "monthly": "price_456monthly",
      "yearly": "price_456yearly",
      "features": [
        "Everything in Pro",
        "Unlimited team members",
        "Admin controls",
        "Usage analytics",
        "Custom integrations",
        "SLA guarantee"
      ]
    }
  }
}
```

#### `POST /billing/create-checkout`
Create a Stripe checkout session for a new subscription.

**Request**:
```http
POST /billing/create-checkout
x-api-key: your_api_key_here
Content-Type: application/json

{
  "priceId": "price_123monthly",
  "successUrl": "https://minoots.com/account?upgraded=true",
  "cancelUrl": "https://minoots.com/pricing"
}
```

**Response**:
```json
{
  "success": true,
  "sessionId": "cs_test_abc123",
  "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_abc123"
}
```

#### `POST /billing/portal`
Create a Stripe customer portal session for managing subscriptions.

**Request**:
```http
POST /billing/portal
x-api-key: your_api_key_here
Content-Type: application/json

{
  "returnUrl": "https://minoots.com/account"
}
```

**Response**:
```json
{
  "success": true,
  "portalUrl": "https://billing.stripe.com/session/test_portal_abc123"
}
```

#### `GET /billing/subscription`
Get the authenticated user's current subscription status.

**Request**:
```http
GET /billing/subscription
x-api-key: your_api_key_here
```

**Response**:
```json
{
  "success": true,
  "status": "active",
  "tier": "pro",
  "currentPeriodEnd": 1705324200000,
  "cancelAtPeriodEnd": false
}
```

---

### 🔔 Webhook Events

MINOOTS sends webhook notifications for timer events. These are fire-and-forget HTTP POST requests to the URL configured in the timer's `on_expire` event.

#### Timer Expired Event
Sent when a timer reaches its expiration time.

```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_abc123def456",
    "name": "My Timer",
    "agentId": "sdk_agent",
    "duration": 300000,
    "startTime": 1705324200000,
    "endTime": 1705324500000,
    "status": "expired",
    "events": {
      "on_expire": {
        "webhook": "https://your-app.com/webhook-endpoint",
        "message": "Optional message for webhook payload",
        "data": {
          "customKey": "customValue"
        }
      }
    },
    "metadata": {
      "createdBy": "user_firebase_uid",
      "userTier": "free",
      "permissionSource": "custom_claims"
    },
    "organizationId": "optional_organization_id",
    "projectId": "optional_project_id",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z"
  },
  "message": "Optional message for webhook payload"
}
```

---

## ❌ ERROR RESPONSES

MINOOTS API returns standard HTTP status codes and a JSON body with `success: false` and an `error` message.

### Standard Error Format
```json
{
  "success": false,
  "error": "Error message describing the issue"
}
```

### Common HTTP Status Codes
- **400 Bad Request**: Invalid input (e.g., malformed JSON, invalid duration format).
- **401 Unauthorized**: Missing or invalid API key.
- **403 Forbidden**: Insufficient permissions or tier limits exceeded.
- **404 Not Found**: Resource not found (e.g., timer ID does not exist).
- **429 Too Many Requests**: Rate limit exceeded.
- **500 Internal Server Error**: An unexpected server-side error occurred.

---

## 📊 RATE LIMITS

MINOOTS API enforces rate limits to ensure fair usage and system stability. Limits vary by user tier.

### Current Rate Limits (per minute)

| Tier | General Requests | Timer Creation |
|------|------------------|----------------|
| Free | 10               | 2              |
| Pro  | 100              | 20             |
| Team | 500              | 50             |
| Enterprise | Custom      | Custom         |

### Rate Limit Headers
Responses include standard rate limit headers:

```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 5
X-RateLimit-Reset: 1705324260
```

---

## 📚 SDK LIBRARIES

### Official Node.js SDK
```bash
npm install minoots-sdk
```

---

## 🔗 USEFUL LINKS

- **GitHub Repository**: https://github.com/Domusgpt/minoots-timer-system

---

**Questions or issues? Contact our support team at [support@minoots.com](mailto:support@minoots.com)**