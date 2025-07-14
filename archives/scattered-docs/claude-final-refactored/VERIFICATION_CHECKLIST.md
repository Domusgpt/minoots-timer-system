# SYSTEMATIC CODE VERIFICATION CHECKLIST

**RULE: Never document anything without verifying it in the actual code first**

## Authentication Verification ✅ COMPLETED

**Checked**: `/functions/middleware/auth.js`

**VERIFIED FACTS:**
- **API Key Method**: `x-api-key` header (Line 56)
- **Firebase Token Method**: `Authorization: Bearer TOKEN` (Line 67)
- **API Key Format**: Must start with `mnt_` (Line 231)
- **Free Endpoints**: `/health`, `/pricing`, `/docs` (Line 35)
- **Anonymous Limits**: 5 timers/day, 50 requests/day (Lines 178-182)

## Still Need to Verify:

### 1. API Endpoints ✅ COMPLETED
**Checked**: `/functions/index.js` - ENTIRE FILE READ

**VERIFIED ENDPOINTS:**
- `POST /timers` (Line 206) - Create timer with limits/RBAC
- `GET /timers` (Line 273) - List timers with filters  
- `GET /timers/:id` (Line 313) - Get specific timer
- `DELETE /timers/:id` (Line 326) - Delete timer
- `POST /quick/wait` (Line 336) - Simple wait timer
- `POST /teams/:team/broadcast` (Line 353) - Team broadcast
- `POST /account/api-keys` (Line 377) - Create API key
- `GET /account/api-keys` (Line 393) - List API keys
- `DELETE /account/api-keys/:keyId` (Line 403) - Revoke API key
- `PUT /account/api-keys/:keyId` (Line 413) - Update API key name
- `GET /account/usage` (Line 424) - Usage statistics
- `GET /mcp/config` (Line 444) - MCP configuration (Pro tier)
- `POST /organizations` (Line 464) - Create organization (Team tier)
- `GET /organizations` (Line 495) - List user organizations
- `GET /organizations/:orgId` (Line 526) - Get organization details
- `POST /organizations/:orgId/invite` (Line 554) - Invite user to org
- `POST /organizations/:orgId/projects` (Line 591) - Create project
- `GET /organizations/:orgId/projects` (Line 631) - List org projects
- `POST /billing/create-checkout` (Line 657) - Stripe checkout
- `POST /billing/portal` (Line 691) - Billing portal
- `GET /billing/subscription` (Line 706) - Get subscription
- `GET /pricing` (Line 719) - Pricing tiers
- `POST /stripe-webhook` (Line 766) - Stripe webhook handler
- `GET /health` (Line 806) - Health check

**AUTHENTICATION**: `x-api-key` header (Line 56 in auth.js)

### 2. Timer Duration Parsing ✅ COMPLETED
**Checked**: Lines 47-56 in index.js

**VERIFIED DURATION PARSING:**
- **Supported Units**: `ms`, `s`, `m`, `h`, `d` (Line 49)
- **Format**: Number + unit (e.g., `30s`, `5m`, `2h`, `1d`) (Line 50)
- **Also Accepts**: Raw milliseconds as number (Line 48)
- **Validation**: Regex `^(\d+)([a-z]+)$/i` (Line 50)
- **Error**: Throws "Invalid duration" or "Unknown unit" (Lines 51, 54)

### 3. Webhook Implementation ✅ COMPLETED
**Checked**: Lines 152-179 in index.js

**VERIFIED WEBHOOK BEHAVIOR:**
- **Trigger**: Only `on_expire` event (Line 162)
- **Method**: POST request (Line 165)
- **Headers**: `Content-Type: application/json` (Line 167)
- **Payload Format** (Lines 168-173):
  ```json
  {
    "event": "timer_expired",
    "timer": {...timer object...},
    "message": "timer.events.on_expire.message",
    "data": "timer.events.on_expire.data"
  }
  ```
- **Error Handling**: Logs error, doesn't retry (Lines 176-178)
- **NO RETRY LOGIC**: Fire-and-forget (Line 177)
- **NO SIGNATURES**: No authentication headers sent

### 4. Rate Limiting ❌ TODO
**Check**: Rate limiting middleware
- Actual limits per tier
- Headers returned
- Enforcement method

### 5. RBAC/Team Features ❌ TODO
**Check**: RBAC system code
- Which org endpoints exist
- Role definitions
- Permission checking

### 6. Billing/Stripe ❌ TODO
**Check**: Stripe integration
- Which billing endpoints exist
- Are they configured/working
- Price IDs and tiers

### 7. MCP Server ❌ TODO
**Check**: `/mcp/index.js`
- Available tools
- Tool schemas
- Configuration method

### 8. SDK ❌ TODO
**Check**: `/sdk/` folder
- Package name
- Available methods
- Usage examples

## DOCUMENTATION WRITING RULE

**BEFORE writing any documentation:**

1. ✅ **Find the actual code** that implements the feature
2. ✅ **Read the code line by line** to understand how it works  
3. ✅ **Copy exact parameter names, formats, responses** from code
4. ✅ **Test the functionality** if possible
5. ✅ **Write documentation** matching exactly what the code does
6. ✅ **Mark uncertainties** clearly if something can't be verified

**NO ASSUMPTIONS. NO GUESSING. CODE IS THE TRUTH.**