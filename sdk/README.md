# MINOOTS Node.js SDK

Official Node.js SDK for the MINOOTS Independent Timer System.

## Installation

```bash
npm install minoots-sdk
```

Or use directly from this repository:

```javascript
const MinootsSDK = require('./minoots-sdk.js');
```

## Quick Start

```javascript
const MinootsSDK = require('minoots-sdk');

// Initialize SDK
const minoots = new MinootsSDK({
    agentId: 'my_agent',
    team: 'my_team'
});

// Create a timer
const timer = await minoots.createTimer({
    name: 'my_task',
    duration: '30s'
});

// Monitor progress
const status = await minoots.getTimer(timer.timer.id);
console.log(`Progress: ${Math.round(status.timer.progress * 100)}%`);
```

## API Reference

### Constructor Options

```javascript
const minoots = new MinootsSDK({
    baseURL: 'https://api-m3waemr5lq-uc.a.run.app',  // Optional: Custom API URL
    agentId: 'my_agent',                               // Optional: Default agent ID
    team: 'my_team',                                   // Optional: Default team
    timeout: 10000                                     // Optional: Request timeout (ms)
});
```

### Core Methods

#### `health()`
Check API health status.

```javascript
const health = await minoots.health();
// Returns: { status: 'healthy', timestamp: 1234567890, service: 'MINOOTS...' }
```

#### `createTimer(config)`
Create a new timer.

```javascript
const timer = await minoots.createTimer({
    name: 'data_processing',
    duration: '5m',                    // '5s', '10m', '2h', '1d' or milliseconds
    agentId: 'optional_agent',         // Defaults to SDK agentId
    team: 'optional_team',             // Defaults to SDK team
    events: {                          // Optional event handlers
        on_expire: {
            message: 'Task completed!',
            webhook: 'https://my-webhook.com/timer-expired',
            data: { custom: 'data' }
        }
    },
    metadata: { custom: 'metadata' }   // Optional metadata
});
```

#### `getTimer(timerId)`
Get timer details and current status.

```javascript
const result = await minoots.getTimer('timer-id');
const timer = result.timer;

console.log(`Status: ${timer.status}`);
console.log(`Progress: ${Math.round(timer.progress * 100)}%`);
console.log(`Time Remaining: ${minoots.formatTimeRemaining(timer.timeRemaining)}`);
```

#### `listTimers(filters)`
List timers with optional filtering.

```javascript
const allTimers = await minoots.listTimers();
const myTimers = await minoots.listTimers({ agentId: 'my_agent' });
const teamTimers = await minoots.listTimers({ team: 'my_team', status: 'running' });
```

#### `deleteTimer(timerId)`
Delete a timer.

```javascript
await minoots.deleteTimer('timer-id');
```

### Quick Methods

#### `quickWait(duration, options)`
Create a simple wait timer.

```javascript
const timer = await minoots.quickWait('30s', {
    name: 'optional_name',
    callback: 'https://webhook-url.com'  // Optional webhook
});
```

#### `waitFor(duration, agentId)`
Create a timer and return a Promise that resolves when it expires.

```javascript
console.log('Starting wait...');
await minoots.waitFor('10s');
console.log('Wait completed!');
```

### Advanced Methods

#### `createTimerWithWebhook(config)`
Create a timer with webhook notification.

```javascript
const timer = await minoots.createTimerWithWebhook({
    name: 'webhook_task',
    duration: '1m',
    webhook: 'https://my-api.com/webhook',
    message: 'Task completed successfully',
    data: { result: 'success', timestamp: Date.now() }
});
```

#### `pollTimer(timerId, intervalMs)`
Monitor a timer and return a Promise that resolves when it expires.

```javascript
const completedTimer = await minoots.pollTimer('timer-id', 1000); // Check every second
console.log('Timer completed:', completedTimer.name);
```

### Team Communication

#### `broadcastToTeam(teamName, message, data)`
Send a message to all team members.

```javascript
await minoots.broadcastToTeam('my_team', 'Task completed!', {
    priority: 'high',
    data: { results: 'success' }
});
```

### Utility Methods

#### `parseDuration(duration)`
Parse duration string to milliseconds.

```javascript
const ms = minoots.parseDuration('5m');  // Returns: 300000
```

#### `formatTimeRemaining(milliseconds)`
Format milliseconds to human-readable string.

```javascript
const formatted = minoots.formatTimeRemaining(65000);  // Returns: "1m 5s"
```

## Usage Examples

### Basic Timer Management

```javascript
const MinootsSDK = require('minoots-sdk');
const minoots = new MinootsSDK({ agentId: 'data_processor' });

async function processData() {
    // Start a processing timer
    const timer = await minoots.createTimer({
        name: 'data_processing',
        duration: '5m',
        events: {
            on_expire: {
                message: 'Data processing completed',
                webhook: 'https://my-api.com/processing-complete'
            }
        }
    });

    console.log(`Processing started: ${timer.timer.id}`);
    
    // Monitor progress
    const completed = await minoots.pollTimer(timer.timer.id);
    console.log('Processing completed!');
}
```

### Agent Coordination

```javascript
async function coordinateAgents() {
    const agentA = new MinootsSDK({ agentId: 'agent_a', team: 'data_team' });
    const agentB = new MinootsSDK({ agentId: 'agent_b', team: 'data_team' });

    // Agent A starts first task
    const taskA = await agentA.createTimer({
        name: 'data_collection',
        duration: '2m'
    });

    // Agent B waits then starts dependent task
    await agentB.waitFor('30s');  // Wait 30 seconds
    
    const taskB = await agentB.createTimer({
        name: 'data_analysis',
        duration: '3m',
        metadata: { depends_on: taskA.timer.id }
    });

    // Wait for both to complete
    await Promise.all([
        agentA.pollTimer(taskA.timer.id),
        agentB.pollTimer(taskB.timer.id)
    ]);

    console.log('All tasks completed!');
}
```

### Recurring Tasks

```javascript
async function setupRecurringCheck() {
    const monitor = new MinootsSDK({ agentId: 'monitor_agent' });

    // Create recurring health check
    function scheduleNextCheck() {
        monitor.createTimerWithWebhook({
            name: 'health_check',
            duration: '5m',
            webhook: 'https://my-api.com/health-check',
            message: 'Scheduled health check',
            data: { next_check: Date.now() + 300000 }
        }).then(() => {
            // Schedule the next check when this one expires
            setTimeout(scheduleNextCheck, 300000);  // 5 minutes
        });
    }

    scheduleNextCheck();
}
```

## Error Handling

The SDK throws descriptive errors for various failure conditions:

```javascript
try {
    await minoots.createTimer({ name: 'test', duration: 'invalid' });
} catch (error) {
    if (error.message.includes('Invalid duration')) {
        console.log('Fix your duration format');
    } else if (error.message.includes('Network error')) {
        console.log('API is unreachable');
    } else {
        console.log('Unexpected error:', error.message);
    }
}
```

## Testing

Run the comprehensive test suite:

```bash
cd sdk
node test/sdk-test.js
```

Run basic examples:

```bash
node examples/basic-usage.js
```

Run agent coordination demos:

```bash
node examples/agent-coordination.js
```

## Requirements

- Node.js 18+ (for built-in `fetch` support)
- Internet connection to MINOOTS API

## License

Proprietary - Paul Phillips (phillips.paul.email@gmail.com)

## Support

- GitHub Issues: https://github.com/Domusgpt/minoots-timer-system/issues
- API Documentation: https://github.com/Domusgpt/minoots-timer-system
- Live API: https://api-m3waemr5lq-uc.a.run.app