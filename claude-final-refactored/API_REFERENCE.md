# API Reference

**Complete and verified endpoint documentation for MINOOTS Timer API**

**Base URL**: `https://api-m3waemr5lq-uc.a.run.app`

---

## Authentication

**Method**: API Key in header
```http
x-api-key: YOUR_API_KEY
```

**API Key Format**: Must start with `mnt_` (verified in code)

**Free Endpoints** (no auth required):
- `GET /health`
- `GET /pricing`
- ~~`GET /docs`~~ **⚠️ MISSING** - Listed but doesn't exist (returns 404)

---

## Timer Operations

### POST /timers
Create a new timer with usage limits and RBAC.

**Request Body**:
```json
{
  "name": "Timer name",
  "duration": "30s",
  "agent_id": "optional_agent_id",
  "organizationId": "optional_org_id", 
  "projectId": "optional_project_id",
  "team": "optional_team_name",
  "events": {
    "on_expire": {
      "webhook": "https://your-endpoint.com",
      "message": "Optional message",
      "data": { "custom": "data" }
    }
  },
  "metadata": { "custom": "metadata" }
}
```

**Duration Formats** (verified in code):
- `30s` (seconds), `5m` (minutes), `2h` (hours), `1d` (days)
- Raw milliseconds as number: `30000`
- Regex validation: `^(\d+)([a-z]+)$/i`

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "generated_uuid",
    "name": "Timer name",
    "agentId": "agent_id", 
    "duration": 30000,
    "startTime": 1705324200000,
    "endTime": 1705324230000,
    "status": "running",
    "events": { "on_expire": {...} },
    "metadata": {
      "createdBy": "user_id",
      "userTier": "free",
      "permissionSource": "custom_claims"
    },
    "organizationId": "org_id",
    "projectId": "project_id",
    "createdAt": "timestamp",
    "updatedAt": "timestamp"
  },
  "usage": {
    "daily": { "used": 1, "limit": 5, "remaining": 4 },
    "concurrent": { "current": 1, "limit": 5, "remaining": 4 }
  }
}
```

### GET /timers
List timers accessible by authenticated user.

**Query Parameters**:
- `agent_id` - Filter by agent ID
- `team` - Filter by team name  
- `status` - Filter by status (`running`, `expired`)
- `organizationId` - Filter by organization
- `projectId` - Filter by project

**Response**:
```json
{
  "success": true,
  "timers": [
    {
      "id": "timer_id",
      "name": "Timer name",
      "agentId": "agent_id",
      "status": "running",
      "timeRemaining": 15000,
      "progress": 0.5,
      "...": "other timer fields"
    }
  ],
  "count": 1,
  "filtered": 0
}
```

### GET /timers/:id
Get specific timer with real-time progress.

**Response**:
```json
{
  "success": true,
  "timer": {
    "id": "timer_id", 
    "status": "running",
    "timeRemaining": 15000,
    "progress": 0.5,
    "...": "all timer fields"
  }
}
```

### DELETE /timers/:id
Delete a timer (removes from Firestore and cancels expiration).

**Response**:
```json
{
  "success": true
}
```

---

## Quick Operations

### POST /quick/wait
Create simple delay timer without complex events.

**Request Body**:
```json
{
  "duration": "5m",
  "name": "Optional name",
  "agent_id": "optional_agent_id",
  "callback": "optional_webhook_url"
}
```

**Response**: Same timer object format

---

## Team Operations

### POST /teams/:team/broadcast
Send message to team members (requires 'manage teams' permission).

**Request Body**:
```json
{
  "message": "Broadcast message",
  "data": { "custom": "data" }
}
```

**Response**:
```json
{
  "success": true,
  "broadcast": {
    "team": "team_name",
    "message": "message",
    "data": {...},
    "timestamp": 1705324200000
  }
}
```

---

## API Key Management

### POST /account/api-keys
Create new API key.

**Request Body**:
```json
{
  "name": "Key name"
}
```

**Response**:
```json
{
  "success": true,
  "apiKey": "mnt_live_...",
  "name": "Key name", 
  "createdAt": "timestamp",
  "warning": "Save this API key - it will not be shown again!"
}
```

### GET /account/api-keys
List user's API keys (keys are masked).

**Response**:
```json
{
  "success": true,
  "apiKeys": [
    {
      "id": "key_id",
      "name": "Key name",
      "createdAt": "timestamp",
      "lastUsed": "timestamp", 
      "totalRequests": 150,
      "keyPreview": "mnt_live_xxxx...xxxx"
    }
  ]
}
```

### DELETE /account/api-keys/:keyId
Revoke API key.

### PUT /account/api-keys/:keyId  
Update API key name.

---

## Account & Usage

### GET /account/usage
Get usage statistics for authenticated user.

**Query Parameters**:
- `days` - Number of days for stats (default: 7)

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

---

## Organization Management

### POST /organizations
Create organization (requires Team tier).

**Request Body**:
```json
{
  "name": "Organization name",
  "slug": "org-slug",
  "settings": {}
}
```

### GET /organizations
List user's organizations.

### GET /organizations/:orgId
Get organization details.

### POST /organizations/:orgId/invite
**⚠️ BROKEN** - Endpoint exists but crashes API (calls non-existent `inviteUserToOrganization()` method).

### POST /organizations/:orgId/projects
Create project in organization.

### GET /organizations/:orgId/projects
List organization projects.

---

## MCP Integration

### GET /mcp/config
Get MCP server configuration (requires Pro tier).

**Response**:
```json
{
  "success": true,
  "mcpServer": {
    "command": "node",
    "args": ["/path/to/mcp/index.js"],
    "env": {
      "MINOOTS_API_BASE": "https://api-m3waemr5lq-uc.a.run.app"
    }
  },
  "message": "Add this configuration to your Claude Desktop settings"
}
```

---

## Billing (Stripe Integration)

### POST /billing/create-checkout
Create Stripe checkout session.

### POST /billing/portal
Create billing portal session.

### GET /billing/subscription
Get current subscription status.

### GET /pricing
Get pricing tiers and features.

**Response**:
```json
{
  "success": true,
  "tiers": {
    "free": { "price": 0, "name": "Free", "features": [...] },
    "pro": { "price": 19, "name": "Pro", "features": [...] },
    "team": { "price": 49, "name": "Team", "features": [...] }
  }
}
```

---

## System Endpoints

### GET /health
Check API health (no auth required).

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

## Webhooks

**Event**: `timer_expired` (only event type)

**Payload sent to webhook URL**:
```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_id",
    "name": "Timer name", 
    "status": "expired",
    "...": "complete timer object"
  },
  "message": "Custom message from on_expire.message",
  "data": "Custom data from on_expire.data"
}
```

**Headers sent**: `Content-Type: application/json`

**Behavior**: 
- Fire-and-forget (no retries)
- No authentication signatures
- Logs errors but continues

---

## Error Responses

**Format**:
```json
{
  "success": false,
  "error": "Error message"
}
```

**HTTP Status Codes**:
- `400` - Bad request (invalid duration, malformed JSON)
- `401` - Invalid/missing API key
- `403` - Insufficient permissions or tier limits
- `404` - Resource not found
- `429` - Rate limit or usage limit exceeded
- `500` - Server error

---

**Changes from Previous Versions:**
- ✅ **Verified against actual code** - Every endpoint, parameter, and response checked
- ✅ **Correct authentication** - Uses `x-api-key` header (not Authorization Bearer for API keys)
- ✅ **Real duration formats** - Only supports single units, not complex formats
- ✅ **Accurate webhook behavior** - Fire-and-forget, no retry logic
- ✅ **Honest about limitations** - No fake features or endpoints