# 🚨 SYSTEM ARCHITECTURE CLARIFICATION - PRODUCTION vs LOCAL

## 📋 CRITICAL CLARIFICATION

**PRODUCTION SYSTEM**: The **webhook-bridge/** Firebase Functions is the ACTUAL production system that the daemon expects.

**LOCAL DEVELOPMENT**: The **mcp-timer-bridge/** was a local development prototype that is NOT compatible with the production daemon.

## 🏗️ CORRECT ARCHITECTURE

### **PRODUCTION SYSTEM (FIREBASE FUNCTIONS)**
```
webhook-bridge/
├── functions/index.js          ← PRODUCTION command queue system
├── firebase.json               ← Firebase deployment config
└── firestore.rules             ← Security rules
```

**What it does:**
- Deploys to Firebase Functions 
- Stores commands in Firestore database
- Provides `/commands/{userId}` endpoint for daemon
- Provides `/markExecuted` endpoint for completion tracking
- Designed for cloud deployment at `https://bridge.minoots.com`

### **DAEMON EXPECTATIONS**
The `system-daemon/minoots-timer-daemon.sh` expects:
- **URL**: Cloud Firebase Functions endpoint (defaults to `https://bridge.minoots.com`)
- **Endpoint**: `GET /commands/{userId}` 
- **Data Format**: webhook-bridge Firebase format
- **Completion**: `POST /markExecuted`

## 🚨 WHAT WAS WRONG BEFORE

### **INCORRECT ASSUMPTION**
We were running the **local mcp-timer-bridge** on localhost:3001 but the daemon was designed for the **cloud webhook-bridge** Firebase Functions.

### **ARCHITECTURE MISMATCH**
- **Daemon**: Expected cloud Firebase Functions
- **Running**: Local Express server  
- **Result**: `Cannot GET /commands/millz_Kalmgogorov` errors

## ✅ CORRECT NEXT STEPS

### **OPTION 1: Deploy Production System (RECOMMENDED)**
```bash
cd webhook-bridge/
firebase deploy --only functions
# This creates the cloud endpoint the daemon expects
```

### **OPTION 2: Local Testing (TEMPORARY)**
```bash
# Update daemon to use local webhook-bridge emulator
cd webhook-bridge/
firebase emulators:start --only functions,firestore
# Point daemon to http://localhost:5001 instead of cloud
```

## 📁 ARCHIVING LOCAL DEVELOPMENT SYSTEM

The **mcp-timer-bridge/** was a local development prototype that caused confusion. It should be archived as it's not the production system.

---

**LESSON**: Always clarify which system is production vs development to avoid architectural confusion.