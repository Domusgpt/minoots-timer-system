# MINOOTS Timer System

**Simple timer API for AI agents and automation workflows**

## What is MINOOTS?

MINOOTS is a Firebase-based timer system that lets AI agents and applications create timers that trigger webhooks when they expire. Perfect for rate limiting, scheduling, timeouts, and workflow coordination.

## What Actually Works Right Now

✅ **Timer API** - Create, read, delete timers  
✅ **Webhook notifications** - Get notified when timers expire  
✅ **Firebase authentication** - Secure user accounts  
✅ **Node.js SDK** - Easy integration  
✅ **Claude Desktop integration** - MCP server for Claude  
✅ **Team features** - Basic organization support  

## Quick Start

### 1. Get API Access
```bash
# Health check
curl https://api-m3waemr5lq-uc.a.run.app/health
```

### 2. Create a Timer
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "30s",
    "name": "My first timer",
    "webhook": "https://your-webhook-url.com/notify"
  }'
```

### 3. When Timer Expires
Your webhook receives:
```json
{
  "event": "timer_expired",
  "timer": {
    "id": "timer_123",
    "name": "My first timer",
    "duration": "30s",
    "status": "expired"
  }
}
```

## Supported Features

### Durations
- `30s` (30 seconds)
- `5m` (5 minutes) 
- `2h` (2 hours)
- `1d` (1 day)

### Timer Operations
- **Create** - `POST /timers`
- **Get status** - `GET /timers/:id`
- **List timers** - `GET /timers`
- **Delete** - `DELETE /timers/:id`

### Webhooks
- **on_expire only** - Triggered when timer completes
- **Simple JSON payload** - Basic timer info
- **Any HTTP endpoint** - Slack, Discord, your API

## Integration Options

### Node.js SDK
```bash
npm install minoots-sdk
```

### Claude Desktop (MCP)
Add to your Claude Desktop config to use timers directly in Claude.

### Direct API
Standard REST API with JSON responses.

## Documentation

- **API Reference** - Complete endpoint documentation
- **Quick Start Guide** - Get running in 5 minutes  
- **MCP Integration** - Claude Desktop setup
- **SDK Guide** - Node.js SDK usage
- **Webhooks** - Integration patterns

## Limitations

- **Firebase only** - No self-hosting options
- **Basic webhooks** - No retry logic or signatures
- **Simple authentication** - API keys only
- **Single webhook per timer** - No multiple notifications

## Support

This is what we actually have working. No enterprise features, no complex monitoring, no advanced security - just a simple, reliable timer API that does what it says.

**API Endpoint**: https://api-m3waemr5lq-uc.a.run.app  
**Status**: Production ready, actively maintained