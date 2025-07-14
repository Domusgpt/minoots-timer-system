# 🚨 ERROR HANDLING GUIDE

**Production-ready error handling patterns for MINOOTS integration.**

## 🔍 COMMON ERRORS

### Authentication Errors
```javascript
// Handle authentication failures
const handleApiCall = async (apiKey) => {
  try {
    const response = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
      headers: { 'x-api-key': apiKey }
    });
    
    if (response.status === 401) {
      throw new Error('Invalid API key');
    }
    
    if (response.status === 403) {
      const error = await response.json();
      throw new Error(`Insufficient permissions: ${error.error}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error.message);
    throw error;
  }
};
```

### Rate Limiting
```javascript
const handleRateLimit = async (response) => {
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const resetTime = response.headers.get('x-ratelimit-reset');
    
    if (retryAfter) {
      console.log(`Rate limited. Retry after ${retryAfter} seconds`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return true; // Should retry
    }
    
    if (resetTime) {
      const waitTime = (resetTime * 1000) - Date.now();
      console.log(`Rate limit resets in ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return true; // Should retry
    }
  }
  
  return false; // Don't retry
};
```

### Tier Limit Exceeded
```javascript
const handleTierLimits = async (error) => {
  if (error.upgradeUrl) {
    console.error(`Tier limit exceeded: ${error.error}`);
    console.log(`Upgrade at: ${error.upgradeUrl}`);
    
    // Notify user about upgrade requirement
    await notifyUser({
      type: 'tier_limit',
      message: error.error,
      upgradeUrl: error.upgradeUrl
    });
    
    throw new Error(`Tier upgrade required: ${error.error}`);
  }
};
```

## 🔄 RETRY STRATEGIES

### Exponential Backoff
```javascript
class RetryableError extends Error {
  constructor(message, retryable = true) {
    super(message);
    this.retryable = retryable;
  }
}

const withRetry = async (operation, maxAttempts = 3, baseDelay = 1000) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.log(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxAttempts || !error.retryable) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Usage
const createTimer = async (config) => {
  return await withRetry(async () => {
    const response = await fetch('https://api-m3waemr5lq-uc.a.run.app/timers', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    if (!response.ok) {
      const error = await response.json();
      
      // Determine if error is retryable
      const retryable = [500, 502, 503, 504].includes(response.status);
      throw new RetryableError(error.error, retryable);
    }
    
    return await response.json();
  });
};
```

### Circuit Breaker Pattern
```javascript
class CircuitBreaker {
  constructor(options = {}) {
    this.threshold = options.threshold || 5;
    this.timeout = options.timeout || 60000; // 1 minute
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.nextAttempt = Date.now();
  }
  
  async call(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }
}

// Usage
const circuitBreaker = new CircuitBreaker({ threshold: 3 });

const safeApiCall = async (config) => {
  try {
    return await circuitBreaker.call(() => createTimer(config));
  } catch (error) {
    console.error('Circuit breaker prevented call:', error.message);
    throw error;
  }
};
```

## 🚨 ERROR MONITORING

### Error Categorization
```javascript
class ErrorHandler {
  static categorize(error, response) {
    if (response?.status >= 500) {
      return {
        type: 'server_error',
        severity: 'high',
        retryable: true,
        action: 'retry_with_backoff'
      };
    }
    
    if (response?.status === 429) {
      return {
        type: 'rate_limit',
        severity: 'medium',
        retryable: true,
        action: 'respect_rate_limit'
      };
    }
    
    if (response?.status === 401) {
      return {
        type: 'auth_error',
        severity: 'high',
        retryable: false,
        action: 'check_credentials'
      };
    }
    
    if (response?.status === 403) {
      return {
        type: 'permission_error',
        severity: 'medium',
        retryable: false,
        action: 'check_tier_or_permissions'
      };
    }
    
    return {
      type: 'unknown_error',
      severity: 'high',
      retryable: false,
      action: 'investigate'
    };
  }
  
  static async handle(error, response, context = {}) {
    const errorInfo = this.categorize(error, response);
    
    // Log error with context
    console.error('MINOOTS API Error:', {
      ...errorInfo,
      message: error.message,
      context,
      timestamp: new Date().toISOString()
    });
    
    // Send to monitoring service
    if (process.env.NODE_ENV === 'production') {
      await this.reportError(error, errorInfo, context);
    }
    
    return errorInfo;
  }
  
  static async reportError(error, errorInfo, context) {
    // Send to your monitoring service (Sentry, DataDog, etc.)
    try {
      await fetch('https://your-monitoring-service.com/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'minoots-integration',
          error: {
            message: error.message,
            stack: error.stack,
            ...errorInfo
          },
          context,
          timestamp: new Date().toISOString()
        })
      });
    } catch (reportingError) {
      console.error('Failed to report error:', reportingError);
    }
  }
}
```

## 🔧 GRACEFUL DEGRADATION

### Fallback Strategies
```javascript
class MinootsClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.fallbackEnabled = true;
    this.localTimers = new Map();
  }
  
  async createTimer(config) {
    try {
      // Try MINOOTS API first
      return await this.createRemoteTimer(config);
    } catch (error) {
      const errorInfo = await ErrorHandler.handle(error, null, { config });
      
      if (this.fallbackEnabled && errorInfo.severity !== 'high') {
        console.warn('Using local fallback timer');
        return this.createLocalTimer(config);
      }
      
      throw error;
    }
  }
  
  createLocalTimer(config) {
    const timerId = `local_${Date.now()}_${Math.random()}`;
    const duration = this.parseDuration(config.duration);
    
    const timer = {
      id: timerId,
      name: config.name,
      status: 'running',
      createdAt: new Date().toISOString(),
      local: true
    };
    
    this.localTimers.set(timerId, timer);
    
    // Set up local timeout
    setTimeout(() => {
      this.handleLocalTimerExpiry(timerId, config);
    }, duration);
    
    return { success: true, timer };
  }
  
  async handleLocalTimerExpiry(timerId, config) {
    const timer = this.localTimers.get(timerId);
    if (!timer) return;
    
    timer.status = 'expired';
    timer.expiredAt = new Date().toISOString();
    
    // Try to execute webhook locally
    if (config.events?.on_expire?.webhook) {
      try {
        await fetch(config.events.on_expire.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'timer_expired',
            timer,
            local: true
          })
        });
      } catch (error) {
        console.error('Local webhook failed:', error);
      }
    }
    
    this.localTimers.delete(timerId);
  }
}
```

## 📊 HEALTH MONITORING

### Service Health Check
```javascript
class HealthMonitor {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.healthStatus = 'unknown';
    this.lastCheck = null;
    this.consecutiveFailures = 0;
  }
  
  async checkHealth() {
    try {
      const response = await fetch('https://api-m3waemr5lq-uc.a.run.app/health', {
        headers: { 'x-api-key': this.apiKey },
        timeout: 10000 // 10 second timeout
      });
      
      if (response.ok) {
        this.healthStatus = 'healthy';
        this.consecutiveFailures = 0;
      } else {
        this.handleUnhealthy('HTTP error', response.status);
      }
    } catch (error) {
      this.handleUnhealthy('Network error', error.message);
    }
    
    this.lastCheck = new Date();
    return this.healthStatus;
  }
  
  handleUnhealthy(reason, details) {
    this.consecutiveFailures++;
    
    if (this.consecutiveFailures >= 3) {
      this.healthStatus = 'unhealthy';
    } else {
      this.healthStatus = 'degraded';
    }
    
    console.warn(`MINOOTS health check failed: ${reason} (${details})`);
  }
  
  isHealthy() {
    return this.healthStatus === 'healthy';
  }
}

// Usage
const healthMonitor = new HealthMonitor(API_KEY);

// Check health every 5 minutes
setInterval(async () => {
  await healthMonitor.checkHealth();
  
  if (!healthMonitor.isHealthy()) {
    // Alert or enable fallback mode
    console.error('MINOOTS service degraded, enabling fallback mode');
  }
}, 5 * 60 * 1000);
```

## 🔒 SECURITY ERROR HANDLING

### API Key Security
```javascript
const validateApiKey = (apiKey) => {
  if (!apiKey) {
    throw new Error('API key is required');
  }
  
  if (!apiKey.startsWith('mnt_')) {
    throw new Error('Invalid API key format');
  }
  
  if (apiKey.includes('test') && process.env.NODE_ENV === 'production') {
    throw new Error('Test API key used in production');
  }
};

const secureApiCall = async (apiKey, endpoint, options = {}) => {
  try {
    validateApiKey(apiKey);
    
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'x-api-key': apiKey,
        ...options.headers
      }
    });
    
    // Don't log full API key in errors
    const maskedKey = `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
    
    if (!response.ok) {
      console.error(`API call failed with key ${maskedKey}:`, response.status);
    }
    
    return response;
  } catch (error) {
    // Never log full API key
    error.message = error.message.replace(apiKey, '[REDACTED]');
    throw error;
  }
};
```