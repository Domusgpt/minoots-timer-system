# ⏲️ MINOOTS Timer System

**A Firebase-based timer system for autonomous agents and workflows.**

## 🎯 WHAT THIS IS

MINOOTS is an experimental timer system that provides persistent, reliable timers for AI agents and applications. Unlike `setTimeout()` which dies when your process crashes, MINOOTS timers run in Firebase Functions and can trigger webhooks when they expire.

## ✅ WHAT ACTUALLY WORKS

### Current Features
- **Timer Creation**: Create timers with specified durations
- **Timer Management**: List, get status, and delete timers  
- **Webhook Notifications**: Get notified when timers expire
- **Firebase Authentication**: Secure API with user accounts
- **Basic RBAC**: Role-based access control (partially deployed)
- **Organization Support**: Team management (implemented, needs testing)

### Live API
- **Base URL**: https://api-m3waemr5lq-uc.a.run.app
- **Health Check**: https://api-m3waemr5lq-uc.a.run.app/health

## 🚀 QUICK START

### 1. Test the Health Endpoint
```bash
curl https://api-m3waemr5lq-uc.a.run.app/health
```

### 2. Create Your First Timer (No Auth Required!)
```bash
# Anonymous users get 5 timers per day
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "Timer expired!"
      }
    }
  }'
```

### 3. Get an API Key for Unlimited Access
```bash
# Anonymous users can bootstrap their first API key!
curl -X POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "My First API Key"}'

# Save the returned API key - it won't be shown again!
```

### 4. Use Your API Key
```bash
# Now use your API key for unlimited timers
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: mnt_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Authenticated Timer",
    "duration": "5m"
  }'
```

## 📝 API REFERENCE

### Authentication Methods

#### 🆓 Anonymous Access (NEW!)
- **No auth required** to get started
- **5 timers per day** limit (per IP address)
- **50 requests per day** limit
- **Get your first API key** without signing up!

#### 🔑 API Key Authentication
- **Get started immediately**: Anonymous users can create API keys
- **Use header**: `x-api-key: mnt_your_key_here`
- **100 timers per day** for free tier
- **Upgrade to paid tiers** for unlimited

#### 🔐 Firebase Authentication
- **Full account features**: Organization management, analytics
- **JWT tokens**: `Authorization: Bearer <token>`
- **Required for**: Team features, billing management

### Endpoints

#### Create Timer
```http
POST /timers
Content-Type: application/json

{
  "name": "Timer Name",
  "duration": "30m",
  "events": {
    "on_expire": {
      "webhook": "https://yourapp.com/webhook"
    }
  }
}
```

#### List Timers
```http
GET /timers
```

#### Get Timer
```http
GET /timers/{id}
```

#### Delete Timer
```http
DELETE /timers/{id}
```

#### Health Check
```http
GET /health
```

### Duration Formats
- `"30s"` - 30 seconds
- `"15m"` - 15 minutes  
- `"2h"` - 2 hours
- `"1d"` - 1 day
- `1800000` - milliseconds

## 🏗️ SYSTEM ARCHITECTURE

### Technology Stack
- **Backend**: Firebase Functions (Node.js)
- **Database**: Firestore
- **Authentication**: Firebase Auth
- **Hosting**: Google Cloud Run

### Current Status
- ✅ **Core API**: Live at https://api-m3waemr5lq-uc.a.run.app
- ✅ **Anonymous Access**: No signup required to start using
- ✅ **API Key Bootstrap**: Anonymous users can get API keys
- ✅ **Timer Operations**: Create, read, update, delete all working
- ✅ **Webhook System**: Timers trigger webhooks when they expire
- ✅ **Usage Tracking**: Rate limiting and tier enforcement
- ✅ **RBAC System**: Role-based access control deployed
- ✅ **Organization Management**: Team features available
- ⏳ **MCP Integration**: Enhanced Claude Code integration (premium)
- ⏳ **Web Dashboard**: Planned

## 🔧 DEVELOPMENT

### Local Development
```bash
# Clone repository
git clone https://github.com/Domusgpt/minoots-timer-system
cd minoots-timer-system

# Install dependencies
cd functions
npm install

# Local testing
npm run test

# Deploy to Firebase
firebase deploy --only functions
```

### Project Structure
```
minoots-timer-system/
├── functions/
│   ├── index.js              # Main API server
│   ├── middleware/auth.js    # Authentication middleware
│   ├── rbac-system/          # Role-based access control
│   └── utils/                # Utility functions
├── docs/                     # Documentation (being corrected)
├── README.md                 # This file
└── firebase.json             # Firebase configuration
```

## 🚀 GETTING STARTED (STEP BY STEP)

### Option 1: Start Anonymous (Fastest)
1. **Test the system**: `curl https://api-m3waemr5lq-uc.a.run.app/health`
2. **Create a timer**: Use the example from Quick Start above
3. **Get API key**: Use the bootstrap endpoint to get unlimited access
4. **Start building**: You're ready to integrate!

### Option 2: Full Account Setup
1. **Sign up**: Create Firebase account (for team features)
2. **Get JWT token**: Use Firebase Auth
3. **Create organization**: Invite team members
4. **Set up billing**: Upgrade to paid tiers

## ⚠️ CURRENT LIMITATIONS

- **No Web Interface**: API only (dashboard coming soon)
- **Basic MCP Integration**: Enhanced session-targeting is premium feature
- **Documentation**: Still being updated to reflect recent fixes

## 🎯 ROADMAP

### ✅ Recently Completed (July 2025)
- Anonymous access and API key bootstrap
- Authentication system fixes
- RBAC deployment and organization features
- Webhook system and timer expiration
- Complete API functionality

### 🚧 In Progress (HIGH PRIORITY)
- Enhanced MCP integration for Claude Code
- Session-targeting timer commands (premium)
- Agent-focused documentation and examples

### 📅 Coming Soon
- Billing and subscription management
- Advanced webhook patterns
- Team collaboration features
- Enterprise SSO integration
- Web dashboard development (lower priority)
- SDK creation for popular languages

## 📞 CONTACT & SUPPORT

- **Repository**: https://github.com/Domusgpt/minoots-timer-system
- **Issues**: Use GitHub issues for bug reports
- **API Questions**: Create GitHub discussions

**For Agents**: This API is designed for autonomous agents and AI systems. The documentation above should give you everything needed to integrate timer functionality into your workflows.

---

**This is experimental software. Use at your own risk. No warranties or guarantees are provided.**

**MINOOTS Timer System** - Reliable timers for autonomous agents and workflows.