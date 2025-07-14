# Authentication Guide

**How to authenticate with MINOOTS API**

## Authentication Methods

MINOOTS supports three authentication methods:

### 1. Anonymous Access (Limited)
No authentication required, but heavily restricted.

**Limits (verified from auth.js lines 178-182)**:
- 5 timers per day
- 50 API requests per day  
- 1 hour maximum timer duration
- Tracked by IP address + date

**Issue**: IP-based tracking means shared networks share limits.

### 2. API Key Authentication (Recommended)
Use `x-api-key` header with your API key.

```bash
curl -H "x-api-key: mnt_live_sk_..." \
  https://api-m3waemr5lq-uc.a.run.app/timers
```

**API Key Format**: Must start with `mnt_` (verified line 231)

### 3. Firebase Authentication
Use Firebase ID token with Bearer authentication.

```bash
curl -H "Authorization: Bearer FIREBASE_ID_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/timers
```

## Getting Started

### Anonymous Testing
```bash
# Works until you hit 5 timer limit
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{"name": "test", "duration": "30s"}'
```

### Getting an API Key

**WARNING**: No automated signup flow exists. The error messages reference:
- `https://minoots.com/signup` - DOES NOT EXIST
- `https://minoots.com/pricing` - DOES NOT EXIST

**Current Process**: Unknown - need manual API key creation.

### Managing API Keys

Once you have authentication, you can manage API keys:

```bash
# Create new API key
curl -X POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Production Key"}'

# List your API keys
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/account/api-keys

# Revoke API key
curl -X DELETE \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/account/api-keys/KEY_ID
```

## Authentication Flow

```
Request without auth
    ↓
Check if anonymous (no headers)
    ↓
If anonymous → Check IP limits
    ├─ Under limit → Allow with restrictions
    └─ Over limit → Require auth (with fake URLs!)
    ↓
Check x-api-key header
    ├─ Valid key → Authenticate
    └─ Invalid → Continue
    ↓
Check Authorization header
    ├─ Valid Firebase token → Authenticate
    └─ Invalid → Return 401
```

## Response Headers

Anonymous requests receive usage information:

```http
X-Anonymous-Timers-Used: 3
X-Anonymous-Timers-Remaining: 2
X-Upgrade-At: 5
X-Anonymous-Limit: reached (when at limit)
```

## Error Responses

### No Authentication
```json
{
  "success": false,
  "error": "Invalid authentication credentials"
}
```

### Anonymous Limit Reached
```json
{
  "success": false,
  "error": "You've reached the anonymous usage limit! Sign up for unlimited timers.",
  "anonymousLimit": true,
  "upgradeMessage": "Create account for unlimited timers + MCP integration",
  "signupUrl": "https://minoots.com/signup",  // FAKE URL!
  "docs": "https://github.com/Domusgpt/minoots-timer-system#authentication"
}
```

### Invalid API Key
```json
{
  "success": false,
  "error": "Invalid authentication credentials"
}
```

### Expired Firebase Token
```json
{
  "success": false,
  "error": "Token expired. Please refresh your authentication."
}
```

## SDK Authentication

**CRITICAL**: The Node.js SDK has NO authentication built in!

You must add authentication yourself:

```javascript
// Add x-api-key to all requests
class AuthenticatedMinootsSDK extends MinootsSDK {
    constructor(apiKey, options = {}) {
        super(options);
        this.apiKey = apiKey;
    }
    
    async _request(method, endpoint, data = null) {
        const config = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey  // ADD THIS
            }
        };
        // ... rest of implementation
    }
}
```

## Security Notes

1. **API keys stored in Firestore** at `/apiKeys/{key}`
2. **Keys track usage**: lastUsed, totalRequests updated per request
3. **Keys can be revoked**: Check for `revoked` field
4. **No key rotation**: Once created, keys don't expire
5. **No key hashing**: Keys stored in plaintext (security issue)

---

**Changes from Previous Versions:**
- ✅ **Three auth methods**: Anonymous, API Key, Firebase
- ✅ **Real limits**: 5 timers/day for anonymous
- ✅ **FAKE URLs exposed**: Signup/pricing URLs don't exist
- ✅ **SDK warning**: No built-in authentication
- ✅ **IP tracking issue**: Shared networks share limits