# 🚨 CURRENT SYSTEM ISSUES AND FIXES - 2025-07-14

## 📋 ISSUES DISCOVERED DURING END-TO-END TESTING

### **ISSUE 1: Manual API Key Bootstrap (UX FLAW)**
**Problem**: Users have to manually request API keys through curl commands
**Current Broken Flow**:
```bash
# User has to do this manually:
curl -X POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "daemon_testing", "permissions": ["timers:create", "timers:read"]}'
```

**NEEDS FIX**: Automatic API key provisioning
- Daemon should auto-bootstrap API key on first run
- Or provide simple setup command that handles this
- No user should ever have to run curl commands manually

### **ISSUE 2: Data Format Mismatch Between Daemon and Webhook-Bridge**
**Problem**: Daemon expects different JSON format than webhook-bridge provides

**Daemon Expects** (from `system-daemon/minoots-timer-daemon.sh`):
```bash
# Tries to parse with jq:
command=$(echo "$response" | jq -r ".[$i].command")
session_id=$(echo "$response" | jq -r ".[$i].session_id") 
working_directory=$(echo "$response" | jq -r ".[$i].working_directory")
timer_name=$(echo "$response" | jq -r ".[$i].timer_name")
command_id=$(echo "$response" | jq -r ".[$i].id")
username=$(echo "$response" | jq -r ".[$i].username")
```

**Webhook-Bridge Provides** (from Firestore structure):
```javascript
{
  command: "command text",
  timer_id: "timer_123",
  timer_name: "Timer Name", 
  session_id: "session_123",
  working_directory: "/path",
  user_id: "user_123",
  username: "username",
  // ... other fields
}
```

**CURRENT ERROR**:
```
jq: error (at <stdin>:1): Cannot index string with string "command"
```

### **ISSUE 3: Authorization Header Mismatch** 
**Problem**: Webhook-bridge expects auth headers, daemon doesn't send them

**Webhook-Bridge Expects**:
```javascript
const authHeader = req.headers.authorization;
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  return res.status(401).json({ error: 'Missing or invalid authorization header' });
}
```

**Daemon Sends**: No authorization header in GET requests

**Current Error**: 
```json
{"error":"Missing or invalid authorization header"}
```

## 🔧 FIXES BEING IMPLEMENTED

### **FIX 1: Update Webhook-Bridge to Match Daemon Format**
Modify `/commands/{userId}` endpoint to return daemon-compatible format

### **FIX 2: Remove Auth Requirement for Command Polling**
Commands endpoint should be publicly accessible for daemon polling

### **FIX 3: Test Complete End-to-End Flow**
1. Create timer with webhook pointing to production bridge
2. Wait for timer to expire  
3. Verify webhook stores command
4. Verify daemon picks up and executes command
5. Verify daemon calls markExecuted

## 🎯 SUCCESS CRITERIA
- Timer expires → Webhook received → Command queued → Daemon executes → Claude Code receives command
- No manual API key steps required
- No jq parsing errors
- Clean logs showing successful command execution

---

**STATUS**: Actively fixing data format and auth issues to complete end-to-end test