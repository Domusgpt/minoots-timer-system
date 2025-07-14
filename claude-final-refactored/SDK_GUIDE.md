# SDK Guide

**Node.js SDK for MINOOTS Timer System**

## Installation

```bash
npm install minoots-timer-sdk
```

**Note**: Package not yet published to npm. For now, copy `sdk/minoots-sdk.js` to your project.

## Basic Usage

```javascript
const MinootsSDK = require('./minoots-sdk');

// Initialize SDK
const minoots = new MinootsSDK({
    agentId: 'my_agent',
    team: 'dev_team'
});

// Create a timer
const result = await minoots.createTimer({
    name: 'deployment_cooldown',
    duration: '5m'
});
```

## Authentication

**CRITICAL**: The SDK has NO authentication built in (verified in code).

You must implement authentication yourself:

```javascript
// EXAMPLE - Not in SDK, you must add this
class AuthenticatedMinootsSDK extends MinootsSDK {
    constructor(apiKey, options = {}) {
        super(options);
        this.apiKey = apiKey;
    }
    
    async _request(method, endpoint, data = null) {
        // Add authentication header
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey  // ADD THIS
            }
        };
        // ... rest of request logic
    }
}
```

## SDK Methods (Verified from minoots-sdk.js)

### Health Check
```javascript
await minoots.health();
// Returns: { status: 'healthy', ... }
```

### Create Timer
```javascript
await minoots.createTimer({
    name: 'timer_name',
    duration: '30s',  // or '5m', '2h', '1d'
    agentId: 'optional_agent_id',
    team: 'optional_team',
    metadata: { custom: 'data' }
});
```

### Get Timer
```javascript
await minoots.getTimer('timer_id');
// Returns: { success: true, timer: {...} }
```

### List Timers
```javascript
await minoots.listTimers({
    agentId: 'filter_agent',
    team: 'filter_team',
    status: 'running'  // or 'expired'
});
```

### Delete Timer
```javascript
await minoots.deleteTimer('timer_id');
```

### Quick Wait
```javascript
await minoots.quickWait('30s', {
    name: 'optional_name',
    agentId: 'optional_agent'
});
```

### Team Broadcast
```javascript
await minoots.broadcastToTeam('team_name', 'message', {
    data: 'optional_data'
});
```

## Advanced Features

### Timer with Webhook
```javascript
await minoots.createTimerWithWebhook({
    name: 'alert_timer',
    duration: '10m',
    webhook: 'https://your-endpoint.com/webhook',
    message: 'Timer expired!',
    data: { alertId: 123 }
});
```

### Recurring Check Pattern
```javascript
await minoots.createRecurringCheck(
    'health_check',
    '5m',
    'https://monitor.example.com/check'
);
```

### Wait For (Async)
```javascript
// Blocks until timer expires
await minoots.waitFor('30s', 'agent_id');
```

### Poll Timer Status
```javascript
// Polls every second until timer expires
const expiredTimer = await minoots.pollTimer('timer_id', 1000);
```

## Utility Methods

### Parse Duration
```javascript
const ms = minoots.parseDuration('5m');  // Returns: 300000
const ms2 = minoots.parseDuration(60000); // Returns: 60000
```

### Format Time Remaining
```javascript
const formatted = minoots.formatTimeRemaining(125000);
// Returns: "2m 5s"
```

## Configuration Options

```javascript
const minoots = new MinootsSDK({
    baseURL: 'https://api-m3waemr5lq-uc.a.run.app',  // default
    agentId: 'default_agent',     // default agent ID
    team: 'default_team',         // default team
    timeout: 10000                // request timeout in ms
});
```

## Error Handling

```javascript
try {
    await minoots.createTimer({ name: 'test', duration: '30s' });
} catch (error) {
    if (error.message.includes('API Error (401)')) {
        // Authentication failed - SDK has no auth!
    } else if (error.message.includes('Network error')) {
        // Connection failed
    } else {
        // Other error
    }
}
```

## Examples

See `/sdk/examples/` for:
- `basic-usage.js` - Simple timer creation
- `agent-coordination.js` - Multi-agent patterns

---

**Changes from Previous Versions:**
- ✅ **Critical warning**: SDK has NO authentication mechanism
- ✅ **Verified methods**: All methods checked against actual SDK code
- ✅ **Real error handling**: Based on actual SDK error messages
- ✅ **Accurate configuration**: Matches SDK constructor options
- ❓ **Unknown**: NPM package name (not published yet)