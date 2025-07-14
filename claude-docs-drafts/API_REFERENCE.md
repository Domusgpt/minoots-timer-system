# API Reference

**Complete reference for MINOOTS Timer API**

Base URL: `https://api-m3waemr5lq-uc.a.run.app`

## Authentication

Include your API key in the Authorization header:
```
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

### GET /health
Check API status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-13T23:45:00Z"
}
```

### POST /timers
Create a new timer.

**Request:**
```json
{
  "duration": "30s",
  "name": "Optional timer name",
  "webhook": "https://your-webhook.com/notify",
  "metadata": {
    "custom": "data"
  }
}
```

**Response:**
```json
{
  "id": "timer_123",
  "duration": "30s",
  "name": "Optional timer name",
  "webhook": "https://your-webhook.com/notify",
  "status": "running",
  "createdAt": "2025-01-13T23:45:00Z",
  "createdBy": "user_456"
}
```

### GET /timers/:id
Get timer status.

**Response:**
```json
{
  "id": "timer_123",
  "duration": "30s",
  "name": "Optional timer name",
  "status": "running",
  "progress": 0.75,
  "timeRemaining": "7s",
  "createdAt": "2025-01-13T23:45:00Z"
}
```

### GET /timers
List all timers for the authenticated user.

**Query Parameters:**
- `status` - Filter by status (running, expired, cancelled)
- `organizationId` - Filter by organization
- `projectId` - Filter by project

**Response:**
```json
[
  {
    "id": "timer_123",
    "duration": "30s",
    "name": "Timer 1",
    "status": "running",
    "createdAt": "2025-01-13T23:45:00Z"
  }
]
```

### DELETE /timers/:id
Cancel and delete a timer.

**Response:**
```json
{
  "success": true,
  "message": "Timer cancelled"
}
```

## Duration Formats

Supported formats (single unit only):
- `30s` - 30 seconds
- `5m` - 5 minutes  
- `2h` - 2 hours
- `1d` - 1 day

## Timer Status

- `running` - Timer is active
- `expired` - Timer completed and webhook sent
- `cancelled` - Timer was deleted before expiring

## Webhook Payload

When a timer expires, your webhook URL receives:
```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_123",
    "name": "Optional timer name",
    "duration": "30s",
    "status": "expired",
    "metadata": {
      "custom": "data"
    }
  }
}
```

## Error Responses

All errors return:
```json
{
  "success": false,
  "error": "Error message"
}
```

Common HTTP status codes:
- `400` - Bad request (invalid duration, missing fields)
- `401` - Unauthorized (invalid API key)
- `404` - Timer not found
- `429` - Rate limit exceeded
- `500` - Server error

## Rate Limits

- **Free tier**: 10 requests per minute
- **Pro tier**: Higher limits (when Stripe is configured)

Rate limit headers:
- `X-RateLimit-Limit` - Requests per window
- `X-RateLimit-Remaining` - Remaining requests
- `Retry-After` - Seconds to wait when rate limited

## Examples

### Create a 5-minute timer
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "5m",
    "name": "Coffee break",
    "webhook": "https://hooks.slack.com/your-webhook"
  }'
```

### Check timer status
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/timer_123
```

### List running timers
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api-m3waemr5lq-uc.a.run.app/timers?status=running"
```

### Cancel a timer
```bash
curl -X DELETE -H "Authorization: Bearer YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/timers/timer_123
```