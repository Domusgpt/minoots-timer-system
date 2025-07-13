# CLAUDE.md - FUNCTIONS DEPLOYMENT GUIDE

## 🚨 CRITICAL FIREBASE FUNCTIONS v2 DEPLOYMENT STANDARDS (2025)

### **DEPLOYMENT FAILURE ANALYSIS**
Our recent deployment showed ALL functions were "Skipped (No changes detected)" which means **NOTHING was deployed**. This is a common Firebase CLI issue when:
1. Functions framework doesn't detect changes properly
2. Git changes aren't committed before deployment
3. FUNCTIONS_DISCOVERY_TIMEOUT is too short for initialization

### **SOLUTION 1: FORCE DEPLOYMENT (IMMEDIATE FIX)**
```bash
# Step 1: Commit ALL changes to functions directory
git add functions/
git commit -m "Update: Force deploy all function changes

- Fix organization invite endpoint implementation
- Fix /docs endpoint with comprehensive documentation  
- Fix analytics endpoints with proper RBAC permissions
- Fix MCP server authentication header
- Replace fake URLs with real GitHub links"

# Step 2: Force deploy with timeout
export FUNCTIONS_DISCOVERY_TIMEOUT=180
firebase deploy --only functions --force
```

### **SOLUTION 2: VERIFY onInit() IMPLEMENTATION (BEST PRACTICE)**

Our current index.js already uses onInit() correctly:
```javascript
onInit(async () => {
  // Initialize Firebase Admin only if not already initialized
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  
  db = admin.firestore();
  setDb(db);
  
  // Initialize RBAC system - defer heavy initialization
  const CustomClaimsManager = require('./rbac-system/core/CustomClaimsManager');
  global.rbacClaimsManager = new CustomClaimsManager(db);
  global.rbacDb = db;
  
  console.log('MINOOTS RBAC system initialized successfully');
});
```

This is CORRECT - all heavy initialization is in onInit().

### **WHY DEPLOYMENT FAILED**
1. **All functions showed "Skipped"** - Firebase didn't detect changes
2. **Functions are already correctly implemented** - no code changes needed
3. **Need to force deploy** to push existing correct code to production

### **🚨 CRITICAL RATE LIMITER BUG DISCOVERED & FIXED**

**PROBLEM**: Functions were returning HTML 500 errors instead of JSON because:
```
ValidationError: express-rate-limit instance should be created at app initialization, not when responding to a request.
```

**ROOT CAUSE**: `dynamicRateLimiter` was creating new rate limiters during request handling (line 90: `const limiter = createLimiter(userTier)`) which violates express-rate-limit v6+ rules.

**SOLUTION**: Pre-create all rate limiters at module initialization:
```javascript
// OLD (BROKEN): Created limiters per request
const dynamicRateLimiter = (req, res, next) => {
  const limiter = createLimiter(userTier); // VIOLATED LIBRARY RULES
  limiter(req, res, next);
};

// NEW (FIXED): Pre-created limiters at module load
const tierLimiters = {};
Object.keys(tierLimits).forEach(tier => {
  tierLimiters[tier] = rateLimit({...}); // Created once at startup
});

const dynamicRateLimiter = (req, res, next) => {
  const limiter = tierLimiters[userTier] || tierLimiters.free; // Reuse existing
  limiter(req, res, next);
};
```

### **VERIFICATION AFTER RATE LIMITER FIX**
After deployment, test timer creation works:

1. **Basic Timer Creation**: 
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{"duration": "5m", "name": "test_after_fix"}'
```

2. **MCP Authentication**: 
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: mnt_test123" \
  -H "Content-Type: application/json" \
  -d '{"duration": "5m", "title": "Test"}'
```

3. **Docs Endpoint**:
```bash
curl https://api-m3waemr5lq-uc.a.run.app/docs
```

### **FIREBASE v2 DEPLOYMENT BEST PRACTICES**

#### **1. ALWAYS USE onInit() FOR INITIALIZATION**
```javascript
const { onInit } = require('firebase-functions/v2/core');

let heavyResources;

onInit(async () => {
  // ALL database connections, API clients, ML models go here
  heavyResources = await initializeExpensiveStuff();
});
```

#### **2. SET DISCOVERY TIMEOUT BEFORE DEPLOYMENT**
```bash
export FUNCTIONS_DISCOVERY_TIMEOUT=180  # 3 minutes minimum
firebase deploy --only functions
```

#### **3. FORCE DEPLOY WHEN FUNCTIONS ARE SKIPPED**
```bash
# If all functions show "Skipped (No changes detected)"
git add functions/ && git commit -m "Force deploy"
firebase deploy --only functions --force
```

#### **4. READ ENTIRE DEPLOYMENT OUTPUT**
- Look for "Skipped (No changes detected)" = FAILURE
- Look for "Successful update operation" = SUCCESS
- Never assume success from green checkmarks alone

#### **5. VERIFY LIVE FUNCTIONALITY**
Always test live endpoints after deployment to confirm fixes are working.

### **CURRENT FUNCTION STATUS**
- ✅ **onInit() properly implemented** - prevents deployment timeouts
- ✅ **All endpoints correctly coded** - invite, docs, analytics, MCP auth
- ❌ **Deployment skipped all functions** - need force deploy
- ❌ **Live API still running old code** - fixes not active

### **NEXT STEPS**
1. Force deploy with the commands above
2. Read ENTIRE deployment output line by line
3. Verify each fix works with curl commands
4. Update this document with deployment results

---

**REMEMBER**: Firebase v2 functions are designed for production workloads. Use onInit() for all heavy initialization, set proper timeouts, and always verify deployments actually update the live functions.