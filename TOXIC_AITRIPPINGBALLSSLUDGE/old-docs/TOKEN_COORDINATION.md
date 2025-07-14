# 🎫 TOKEN COORDINATION GUIDE

**Handle API rate limits and token management with MINOOTS.**

## 🚦 RATE LIMIT PATTERNS

### GitHub API Rate Limits
```javascript
const handleGitHubRateLimit = async (response) => {
  if (response.status === 403 && response.headers['x-ratelimit-remaining'] === '0') {
    const resetTime = parseInt(response.headers['x-ratelimit-reset']) * 1000;
    const waitTime = Math.max(0, resetTime - Date.now());
    
    await minoots.timers.create({
      name: 'GitHub API Reset',
      duration: waitTime,
      events: {
        on_expire: {
          webhook: 'https://your-app.com/resume-github-ops'
        }
      }
    });
  }
};
```

### OpenAI API Token Management
```javascript
const manageOpenAITokens = async (usage) => {
  const dailyLimit = 1000000; // 1M tokens
  const remaining = dailyLimit - usage.total_tokens;
  
  if (remaining < 10000) { // Less than 10k tokens left
    const resetTime = new Date();
    resetTime.setHours(24, 0, 0, 0); // Next midnight
    
    await minoots.timers.create({
      name: 'OpenAI Token Reset',
      duration: resetTime.getTime() - Date.now(),
      events: {
        on_expire: {
          webhook: 'https://your-app.com/resume-ai-operations'
        }
      }
    });
  }
};
```

## 🔄 RETRY STRATEGIES

### Exponential Backoff
```javascript
const createRetryTimer = async (attempt, maxAttempts = 5) => {
  if (attempt >= maxAttempts) {
    throw new Error('Max retry attempts exceeded');
  }
  
  const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30 seconds
  
  return await minoots.timers.create({
    name: `Retry Attempt ${attempt + 1}`,
    duration: delay,
    events: {
      on_expire: {
        webhook: 'https://your-app.com/retry-operation',
        data: { attempt: attempt + 1 }
      }
    }
  });
};
```

### Circuit Breaker Pattern
```javascript
class CircuitBreaker {
  constructor(service) {
    this.service = service;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.threshold = 5;
  }
  
  async onFailure() {
    this.failures++;
    
    if (this.failures >= this.threshold && this.state === 'CLOSED') {
      this.state = 'OPEN';
      
      // Schedule circuit breaker reset
      await minoots.timers.create({
        name: `Circuit Breaker Reset: ${this.service}`,
        duration: '5m',
        events: {
          on_expire: {
            webhook: `https://your-app.com/reset-circuit/${this.service}`
          }
        }
      });
    }
  }
}
```

## 📊 TOKEN BUDGETING

### Daily Token Budget Management
```javascript
const manageDailyBudget = async (service, tokensUsed, dailyBudget) => {
  const percentage = (tokensUsed / dailyBudget) * 100;
  
  if (percentage >= 80) { // 80% budget used
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    await minoots.timers.create({
      name: `${service} Budget Reset`,
      duration: tomorrow.getTime() - now.getTime(),
      events: {
        on_expire: {
          webhook: `https://your-app.com/reset-budget/${service}`,
          data: { newBudget: dailyBudget }
        }
      }
    });
  }
};
```

## 🎯 SMART SCHEDULING

### Off-Peak API Usage
```javascript
const scheduleOffPeakOperation = async (operation) => {
  const now = new Date();
  const offPeakStart = new Date(now);
  offPeakStart.setHours(2, 0, 0, 0); // 2 AM
  
  if (now.getHours() >= 2 && now.getHours() < 8) {
    // We're in off-peak, execute now
    return executeOperation(operation);
  }
  
  // Schedule for next off-peak window
  if (now.getHours() >= 8) {
    offPeakStart.setDate(offPeakStart.getDate() + 1);
  }
  
  await minoots.timers.create({
    name: `Off-Peak Operation: ${operation.name}`,
    duration: offPeakStart.getTime() - now.getTime(),
    events: {
      on_expire: {
        webhook: 'https://your-app.com/execute-off-peak',
        data: operation
      }
    }
  });
};
```