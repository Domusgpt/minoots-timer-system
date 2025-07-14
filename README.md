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

### 2. Create a Timer (Anonymous - Limited)
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Timer",
    "duration": "5m",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url"
      }
    }
  }'
```

### 3. List Your Timers
```bash
curl https://api-m3waemr5lq-uc.a.run.app/timers
```

## 📝 API REFERENCE

### Authentication
- **Anonymous**: Limited to 5 timers per day per IP
- **Firebase Auth**: Full access with user account
- **API Keys**: For programmatic access (requires auth)

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
- ✅ **Core API**: Deployed and working
- ✅ **Timer Operations**: Create, read, update, delete
- ✅ **Authentication**: Firebase Auth integration
- ✅ **RBAC System**: Implemented (trigger functions need retry)
- ✅ **Organization Management**: Coded (needs testing)
- ⏳ **MCP Integration**: Planned
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

## ⚠️ CURRENT LIMITATIONS

- **No Web Interface**: API only, no dashboard yet
- **Basic Error Handling**: Needs improvement
- **Limited Documentation**: Being rewritten to reflect reality
- **RBAC Incomplete**: Trigger functions need redeployment
- **No SDK**: Direct API calls only
- **No Enterprise Features**: Basic system only

## 🚧 WHAT'S BEING FIXED

We recently discovered that much of our documentation contained false information about features that don't exist. We're currently:

1. **Auditing all documentation** for false claims
2. **Removing fake pricing information** and enterprise features
3. **Eliminating false contact information** and support claims  
4. **Rewriting guides** to reflect actual capabilities
5. **Testing existing features** to verify they work

See `DOCUMENTATION_FRAUD_AUDIT.md` for the complete correction log.

## 📋 IMMEDIATE TODO

- [ ] Complete RBAC deployment (retry trigger functions)
- [ ] Test organization management features
- [ ] Create truthful API documentation
- [ ] Build basic web dashboard
- [ ] Add comprehensive error handling
- [ ] Write actual quick start guide
- [ ] Implement MCP integration for Claude

## 🤝 CONTRIBUTING

This is an experimental project. If you want to contribute:

1. Test the current API and report issues
2. Help correct the fraudulent documentation
3. Suggest realistic features that would be useful
4. Help test the RBAC system once deployed

## 📞 CONTACT

- **Repository**: https://github.com/Domusgpt/minoots-timer-system
- **Issues**: Use GitHub issues for bug reports
- **Questions**: Create GitHub discussions

**Note**: We do not currently have enterprise support, paid plans, or professional services. Those were erroneously documented and are being removed.

---

**This is experimental software. Use at your own risk. No warranties or guarantees are provided.**