# 🧪 MINOOTS RBAC TESTING SPECIFICATIONS

## 🎯 FOR TESTING AGENTS - WHAT TO TEST AND HOW

### 📋 TESTING RESPONSIBILITY BREAKDOWN

**CODING AGENTS (me)**: Build the system, document it, create test specs
**TESTING AGENTS (you)**: Execute tests, verify functionality, report results
**DEPLOYMENT AGENTS**: Deploy based on test results
**DOCUMENTATION AGENTS**: Update docs based on test findings

## 🚀 TESTING PHASES

### PHASE 1: Unit Testing (Infrastructure)
**STATUS**: ✅ COMPLETED by coding agent
**LOCATION**: `phases/phase-1/rbac-system/tests/rbac-test.js`
**RESULTS**: 9/9 tests passing

### PHASE 2: Integration Testing (YOUR JOB)
**PURPOSE**: Test RBAC integration with existing production API
**PRIORITY**: 🔥 HIGH - BLOCKING DEPLOYMENT

#### TEST ENVIRONMENT SETUP
```bash
# 1. Set up test environment
cd /mnt/c/Users/millz/minoots-timer-system
git checkout phase-1-rbac-system

# 2. Install dependencies (if needed)
cd functions && npm install

# 3. Start Firebase emulators
firebase emulators:start --only firestore,auth,functions

# 4. Test endpoints
curl -X POST http://localhost:5001/.../api/test-endpoint
```

#### INTEGRATION TEST CASES

##### Test Case 1: Auth Middleware Integration
```bash
# Test that existing auth still works
curl -X GET https://api-m3waemr5lq-uc.a.run.app/health
# Expected: {"status":"healthy",...}

# Test that protected endpoints still require auth
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers
# Expected: {"error":"Authentication required..."}
```

##### Test Case 2: RBAC Permission Checks
```bash
# Test with free tier user (should have limited permissions)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer FREE_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test","duration":"30s"}'
# Expected: Success (within free tier limits)

# Test enterprise feature access
curl -X GET https://api-m3waemr5lq-uc.a.run.app/mcp/config \
  -H "Authorization: Bearer FREE_USER_TOKEN"
# Expected: 403 Forbidden (requires Pro tier)
```

##### Test Case 3: Organization Management
```bash
# Test organization creation
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations \
  -H "Authorization: Bearer PRO_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Org","tier":"team"}'
# Expected: Organization created successfully

# Test user invitation
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/ORG_ID/invite \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","role":"editor"}'
# Expected: Invitation sent successfully
```

### PHASE 3: Performance Testing (YOUR JOB)
**PURPOSE**: Verify RBAC doesn't slow down the API
**PRIORITY**: 🔥 HIGH - CRITICAL FOR PRODUCTION

#### Performance Test Cases

##### Test Case 1: Permission Check Latency
```bash
# Benchmark auth middleware response time
ab -n 1000 -c 10 -H "Authorization: Bearer VALID_TOKEN" \
  https://api-m3waemr5lq-uc.a.run.app/timers

# Success criteria:
# - 95th percentile < 50ms
# - No timeouts
# - Zero errors
```

##### Test Case 2: Custom Claims Performance
```javascript
// Test Claims vs Firestore performance
const startTime = Date.now();
const permission = await claimsManager.validatePermission(userId, 'create', 'timers');
const endTime = Date.now();

// Success criteria:
// - Claims-based checks: < 20ms
// - Firestore-based checks: < 100ms
// - 90% of checks use Claims (not Firestore)
```

##### Test Case 3: Concurrent User Load
```bash
# Test with multiple users simultaneously
for i in {1..100}; do
  curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
    -H "Authorization: Bearer USER_${i}_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"load_test_'$i'","duration":"30s"}' &
done

# Success criteria:
# - All requests succeed
# - No permission errors
# - Response time < 500ms
```

### PHASE 4: Security Testing (YOUR JOB)
**PURPOSE**: Verify no privilege escalation or security bypasses
**PRIORITY**: 🔥 CRITICAL - SECURITY VULNERABILITY CHECK

#### Security Test Cases

##### Test Case 1: Privilege Escalation Prevention
```bash
# Test that editors cannot assign admin roles
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/ORG_ID/members \
  -H "Authorization: Bearer EDITOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"target_user","role":"admin"}'
# Expected: 403 Forbidden

# Test that non-owners cannot manage billing
curl -X POST https://api-m3waemr5lq-uc.a.run.app/organizations/ORG_ID/billing \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"change_plan"}'
# Expected: 403 Forbidden (only owners can manage billing)
```

##### Test Case 2: Token Manipulation Resistance
```bash
# Test with tampered JWT tokens
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer TAMPERED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"hack_attempt","duration":"30s"}'
# Expected: 401 Unauthorized

# Test with expired tokens
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Authorization: Bearer EXPIRED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"expired_test","duration":"30s"}'
# Expected: 401 Unauthorized
```

##### Test Case 3: Resource Access Validation
```bash
# Test cross-organization access prevention
curl -X GET https://api-m3waemr5lq-uc.a.run.app/projects/OTHER_ORG_PROJECT_ID \
  -H "Authorization: Bearer USER_ORG_A_TOKEN"
# Expected: 403 Forbidden

# Test timer access by non-collaborators
curl -X DELETE https://api-m3waemr5lq-uc.a.run.app/timers/OTHER_USER_TIMER_ID \
  -H "Authorization: Bearer UNAUTHORIZED_USER_TOKEN"
# Expected: 403 Forbidden
```

### PHASE 5: Backward Compatibility Testing (YOUR JOB)
**PURPOSE**: Ensure existing users/integrations don't break
**PRIORITY**: 🔥 CRITICAL - USER EXPERIENCE

#### Compatibility Test Cases

##### Test Case 1: Existing API Key Functionality
```bash
# Test that existing API keys still work
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: EXISTING_PROD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"compat_test","duration":"30s"}'
# Expected: Success (existing functionality preserved)
```

##### Test Case 2: MCP Integration Compatibility
```bash
# Test that MCP server still works for Pro users
# (Test using existing MCP test in mcp/test/mcp-test.js)
cd mcp && npm test
# Expected: All MCP tests pass
```

##### Test Case 3: SDK Compatibility
```bash
# Test that existing SDK still works
cd sdk && npm test
# Expected: All SDK tests pass
```

## 📊 SUCCESS CRITERIA SUMMARY

### ✅ PASS CONDITIONS:
- **Performance**: 95th percentile API response < 50ms
- **Security**: Zero privilege escalation vulnerabilities
- **Compatibility**: 100% existing functionality preserved
- **Reliability**: 99.9% test success rate
- **Load**: Handle 100 concurrent users without errors

### ❌ FAIL CONDITIONS:
- Any security vulnerability discovered
- Performance regression > 20%
- Existing API functionality broken
- Test success rate < 95%
- Claims sync failures > 1%

## 🚨 TESTING AGENT RESPONSIBILITIES

### REQUIRED DELIVERABLES:
1. **Test Execution Report**: Results of all test cases
2. **Performance Benchmarks**: Before/after metrics comparison
3. **Security Audit**: Vulnerability assessment results
4. **Compatibility Report**: Existing functionality verification
5. **Deployment Recommendation**: GO/NO-GO decision with justification

### ESCALATION CRITERIA:
- **BLOCKER**: Any security vulnerability or existing functionality broken
- **HIGH**: Performance regression > 10%
- **MEDIUM**: Non-critical feature issues
- **LOW**: Documentation or minor UX issues

### REPORTING FORMAT:
```markdown
# RBAC TESTING REPORT

## EXECUTIVE SUMMARY
- Overall Status: PASS/FAIL
- Deployment Recommendation: GO/NO-GO
- Critical Issues Found: X
- Performance Impact: +/- X%

## DETAILED RESULTS
[Test case results...]

## RECOMMENDATIONS
[Next steps...]
```

## 🔄 FEEDBACK LOOP

### IF TESTS FAIL:
1. **Document specific failures** with reproduction steps
2. **Assign back to coding agent** for fixes
3. **Re-test after fixes** to verify resolution
4. **Update test specifications** if needed

### IF TESTS PASS:
1. **Document successful results**
2. **Provide deployment recommendation**
3. **Hand off to deployment agent**
4. **Monitor production deployment**

---

**TESTING AGENTS**: Use these specifications to verify the RBAC system is production-ready. Report all findings and provide clear GO/NO-GO recommendation for deployment.