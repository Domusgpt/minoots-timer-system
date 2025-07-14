# Monitoring Guide

**Current monitoring capabilities in MINOOTS**

## What's Actually Implemented

### 1. Basic Console Logging

The system uses `console.log` and `console.error` throughout:

```javascript
// Timer creation
console.log(`Timer created: ${timerData.name} (${timerId}) - expires in ${duration}ms`);

// Timer expiration  
console.log(`Timer expiring: ${timer.name} (${timerId})`);

// Webhook calls
console.log(`Webhook called: ${timer.events.on_expire.webhook} (${response.status})`);

// Errors
console.error('Auth error:', error);
console.error('Create timer error:', error);
```

### 2. Usage Tracking

**Implemented in `/utils/usageTracking.js`**:

- Daily timer creation counts
- API request counts per user
- Concurrent timer tracking
- Usage stats retrieval

```bash
# Get usage stats (last 7 days)
curl -H "x-api-key: YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/account/usage?days=7
```

Response:
```json
{
  "success": true,
  "usage": {
    "dailyTimersCreated": 15,
    "concurrentTimers": 3
  },
  "apiKeys": {
    "activeKeys": 2,
    "totalRequests": 150,
    "averageRequestsPerKey": 75
  },
  "tier": "free"
}
```

### 3. Firestore Collections for Tracking

**Collections used**:
- `usage` - Daily usage per user (not usage_tracking)
- `timer_logs` - Timer expiration events
- `anonymous_usage` - Anonymous user tracking
- `team_broadcasts` - Team communication logs

### 4. API Key Usage

Each API key tracks:
- `lastUsed` - Timestamp of last use
- `totalRequests` - Running count of requests

## What's NOT Implemented

### Missing Monitoring Features

1. **No APM Integration** - No New Relic, Datadog, etc.
2. **No Metrics Export** - No Prometheus, StatsD
3. **No Structured Logging** - Just console.log
4. **No Error Tracking** - No Sentry, Rollbar
5. **No Uptime Monitoring** - No health check alerts
6. **No Performance Metrics** - No latency tracking
7. **No Custom Dashboards** - No Grafana, Kibana
8. **No Log Aggregation** - Logs only in Cloud Functions

### Analytics Mentioned But Not Implemented

The code references `view_analytics` permission for team/enterprise tiers, but no analytics endpoints exist.

## Using Cloud Functions Logs

Since MINOOTS runs on Firebase Cloud Functions, you can view logs in:

1. **Firebase Console**
   - Navigate to Functions
   - Click on function name
   - View logs tab

2. **Google Cloud Console**
   - Cloud Logging service
   - Filter by resource.type="cloud_function"

3. **gcloud CLI**
   ```bash
   gcloud functions logs read api --limit 50
   ```

## Manual Monitoring Queries

### Check Timer Creation Rate
```javascript
// In Firestore console
db.collection('usage_tracking')
  .where('userId', '==', 'USER_ID')
  .where('date', '>=', new Date('2024-01-01'))
  .get()
```

### Check Failed Webhooks
Search Cloud Functions logs for:
```
"Webhook failed:"
```

### Monitor Anonymous Usage
```javascript
db.collection('anonymous_usage')
  .where('lastUsed', '>=', new Date(Date.now() - 86400000))
  .get()
```

## Recommendations for Real Monitoring

To add proper monitoring, you would need:

1. **Structured Logging**
   ```javascript
   const winston = require('winston');
   const logger = winston.createLogger({
     format: winston.format.json(),
     transports: [new winston.transports.Console()]
   });
   ```

2. **Metrics Collection**
   ```javascript
   const prometheus = require('prom-client');
   const timerCounter = new prometheus.Counter({
     name: 'timers_created_total',
     help: 'Total number of timers created'
   });
   ```

3. **Error Tracking**
   ```javascript
   const Sentry = require('@sentry/node');
   Sentry.init({ dsn: 'YOUR_SENTRY_DSN' });
   ```

4. **APM Integration**
   ```javascript
   require('newrelic');  // At top of index.js
   ```

## Current Observability

What you CAN monitor now:
- ✅ Total timers created per user
- ✅ API request counts
- ✅ Concurrent timer counts
- ✅ Basic error logs in Cloud Functions
- ✅ API key usage patterns

What you CANNOT monitor:
- ❌ Response time percentiles
- ❌ Error rates by endpoint
- ❌ Webhook delivery success rate
- ❌ System resource usage
- ❌ Real-time alerts
- ❌ Historical performance trends

---

**Changes from Previous Versions:**
- ✅ **Honest assessment**: Only console.log monitoring exists
- ✅ **Real tracking**: Usage tracking for billing/limits only
- ✅ **No false claims**: No APM, metrics, or analytics systems
- ✅ **Practical guidance**: How to use Cloud Functions logs
- ✅ **Clear gaps**: What monitoring is actually missing