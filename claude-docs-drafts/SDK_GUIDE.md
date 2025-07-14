# Node.js SDK Guide

**Easy integration with the MINOOTS Timer API**

## Installation

```bash
npm install minoots-sdk
```

## Basic Usage

```javascript
const { MinootsClient } = require('minoots-sdk');

const client = new MinootsClient({
  apiKey: 'your_api_key_here',
  apiUrl: 'https://api-m3waemr5lq-uc.a.run.app' // optional, this is default
});
```

## Create a Timer

```javascript
async function createTimer() {
  try {
    const timer = await client.createTimer({
      duration: '30s',
      name: 'My timer',
      webhook: 'https://your-webhook.com/notify',
      metadata: {
        userId: '123',
        action: 'reminder'
      }
    });
    
    console.log('Timer created:', timer.id);
    return timer;
  } catch (error) {
    console.error('Failed to create timer:', error.message);
  }
}
```

## Get Timer Status

```javascript
async function checkTimer(timerId) {
  try {
    const timer = await client.getTimer(timerId);
    
    console.log(`Timer ${timer.id}:`);
    console.log(`Status: ${timer.status}`);
    console.log(`Progress: ${timer.progress * 100}%`);
    console.log(`Time remaining: ${timer.timeRemaining}`);
    
    return timer;
  } catch (error) {
    console.error('Failed to get timer:', error.message);
  }
}
```

## List Timers

```javascript
async function listTimers() {
  try {
    const timers = await client.listTimers({
      status: 'running' // optional filter
    });
    
    console.log(`Found ${timers.length} running timers`);
    timers.forEach(timer => {
      console.log(`- ${timer.name}: ${timer.timeRemaining} remaining`);
    });
    
    return timers;
  } catch (error) {
    console.error('Failed to list timers:', error.message);
  }
}
```

## Cancel a Timer

```javascript
async function cancelTimer(timerId) {
  try {
    await client.deleteTimer(timerId);
    console.log(`Timer ${timerId} cancelled`);
  } catch (error) {
    console.error('Failed to cancel timer:', error.message);
  }
}
```

## Error Handling

The SDK throws errors for various conditions:

```javascript
async function handleErrors() {
  try {
    const timer = await client.createTimer({
      duration: 'invalid', // This will throw
      name: 'Test timer'
    });
  } catch (error) {
    if (error.status === 400) {
      console.error('Bad request:', error.message);
    } else if (error.status === 401) {
      console.error('Invalid API key');
    } else if (error.status === 429) {
      console.error('Rate limited, retry after:', error.retryAfter);
    } else {
      console.error('Unexpected error:', error.message);
    }
  }
}
```

## Complete Example

```javascript
const { MinootsClient } = require('minoots-sdk');

class TimerManager {
  constructor(apiKey) {
    this.client = new MinootsClient({ apiKey });
    this.activeTimers = new Map();
  }
  
  async startWorkflowTimeout(workflowId, timeoutMinutes = 10) {
    const timer = await this.client.createTimer({
      duration: `${timeoutMinutes}m`,
      name: `Workflow timeout: ${workflowId}`,
      webhook: `https://your-app.com/api/workflows/${workflowId}/timeout`,
      metadata: {
        type: 'workflow_timeout',
        workflowId: workflowId
      }
    });
    
    this.activeTimers.set(workflowId, timer.id);
    console.log(`Started ${timeoutMinutes}m timeout for workflow ${workflowId}`);
    
    return timer;
  }
  
  async cancelWorkflowTimeout(workflowId) {
    const timerId = this.activeTimers.get(workflowId);
    if (timerId) {
      await this.client.deleteTimer(timerId);
      this.activeTimers.delete(workflowId);
      console.log(`Cancelled timeout for workflow ${workflowId}`);
    }
  }
  
  async checkActiveTimers() {
    const timers = await this.client.listTimers({ status: 'running' });
    
    console.log(`Active timers: ${timers.length}`);
    timers.forEach(timer => {
      console.log(`- ${timer.name}: ${timer.timeRemaining} remaining`);
    });
    
    return timers;
  }
}

// Usage
async function main() {
  const manager = new TimerManager('your_api_key_here');
  
  // Start a workflow with timeout
  await manager.startWorkflowTimeout('workflow_123', 5);
  
  // Check status
  await manager.checkActiveTimers();
  
  // Cancel if needed
  // await manager.cancelWorkflowTimeout('workflow_123');
}

main().catch(console.error);
```

## Configuration Options

```javascript
const client = new MinootsClient({
  apiKey: 'your_api_key_here',
  apiUrl: 'https://api-m3waemr5lq-uc.a.run.app', // Custom API endpoint
  timeout: 10000, // Request timeout in ms (default: 5000)
  retries: 3, // Number of retries (default: 0)
  userAgent: 'MyApp/1.0' // Custom user agent
});
```

## Webhook Integration

When your timer expires, your webhook receives:

```javascript
// Express.js webhook handler example
app.post('/api/timer-expired', (req, res) => {
  const { event, timer } = req.body;
  
  if (event === 'timer_expired') {
    console.log(`Timer ${timer.id} expired:`, timer.name);
    
    // Handle the timer expiration
    handleTimerExpired(timer);
  }
  
  res.status(200).send('OK');
});

function handleTimerExpired(timer) {
  if (timer.metadata?.type === 'workflow_timeout') {
    // Handle workflow timeout
    console.log(`Workflow ${timer.metadata.workflowId} timed out`);
  }
}
```

## Rate Limiting

The SDK automatically handles rate limiting:

```javascript
// The SDK will automatically retry with exponential backoff
const timer = await client.createTimer({
  duration: '1m',
  name: 'Rate limited request'
});
```

For high-volume usage, consider implementing your own rate limiting:

```javascript
const timers = [];
const batchSize = 10;

for (let i = 0; i < requests.length; i += batchSize) {
  const batch = requests.slice(i, i + batchSize);
  
  const batchTimers = await Promise.all(
    batch.map(req => client.createTimer(req))
  );
  
  timers.push(...batchTimers);
  
  // Wait between batches to avoid rate limits
  if (i + batchSize < requests.length) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```