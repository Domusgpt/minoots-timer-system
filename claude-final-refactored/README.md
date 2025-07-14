# MINOOTS Timer System

**A Firebase-based timer API for AI agents and automation workflows**

## What is MINOOTS?

MINOOTS provides a reliable timer system that lets AI agents and applications create timers that trigger webhooks when they expire. Built on Firebase and Google Cloud Functions for scalability and reliability.

## ✨ Core Features

**Verified Working:**
- **Timer Management**: Create, retrieve, list, and delete timers with flexible durations
- **Webhook Notifications**: HTTP POST requests when timers expire  
- **API Key Authentication**: Secure access using unique API keys
- **Role-Based Access Control**: User permissions and organization support
- **Claude Desktop Integration**: MCP server for Claude agents
- **Node.js SDK**: Easy programmatic integration

**Code Exists (Configuration Status Unknown):**
- **Tier-Based Rate Limiting**: Dynamic limits based on subscription tiers
- **Organization & Project Support**: Team collaboration structures
- **Billing Integration**: Stripe payment processing code exists

## 🚀 Quick Start

### 1. API Health Check
```bash
curl https://api-m3waemr5lq-uc.a.run.app/health
```

### 2. Create Your First Timer
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url"
      }
    }
  }'
```

### 3. Monitor Timer Status
```bash
curl https://api-m3waemr5lq-uc.a.run.app/timers/TIMER_ID \
  -H "x-api-key: YOUR_API_KEY"
```

## 📚 Documentation

- **[API Reference](./API_REFERENCE.md)** - Complete endpoint documentation
- **[Quick Start Guide](./QUICK_START.md)** - Get running in 5 minutes  
- **[MCP Integration](./MCP_INTEGRATION.md)** - Claude Desktop setup
- **[SDK Guide](./SDK_GUIDE.md)** - Node.js SDK usage
- **[Webhooks](./WEBHOOKS.md)** - Integration patterns
- **[Authentication](./AUTHENTICATION.md)** - Security and permissions
- **[Team Features](./TEAM_FEATURES.md)** - Organization support

## 🛠️ Development & Deployment

**Built on Firebase:**
- Node.js (>=18.0.0)
- Firebase CLI (`npm install -g firebase-tools`)
- Google Cloud Functions v2

**Deploy:**
```bash
firebase deploy --only functions,firestore
```

## ⚠️ Current Limitations

- **Basic webhooks only**: Fire-and-forget, no retry logic or signatures
- **Configuration unknown**: Some features coded but not confirmed working
- **No custom monitoring**: Uses Google Cloud's built-in logging only
- **Firebase-only deployment**: No self-hosting options currently

## 🎯 Supported Integrations

- **Claude Desktop**: MCP server for direct Claude integration
- **Node.js**: Official SDK available (`minoots-sdk`)
- **Slack/Discord**: Via webhook formatting in your handler
- **Any HTTP endpoint**: Standard webhook delivery

## 📞 Status

**Production API**: https://api-m3waemr5lq-uc.a.run.app  
**Repository**: https://github.com/Domusgpt/minoots-timer-system  
**License**: Private/Proprietary

This system is under active development. Features and documentation are being refined based on actual implementation status rather than aspirational claims.

---

**Changes from Original Versions:**
- **Removed fictional contact info** (support emails, domains)
- **Marked configuration status** clearly for uncertain features  
- **Combined Gemini's structure** with Claude's honesty about limitations
- **Focused on verified working features** only
- **Added clear current limitations** section