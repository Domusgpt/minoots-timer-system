# 🧪 COMPREHENSIVE TESTING GUIDE

**Complete testing framework and procedures for MINOOTS timer system development.**

## 🎯 TESTING STRATEGY

### Testing Pyramid
```
                   E2E Tests (5%)
                     /        \
                UI Tests (15%)
               /                \
          Integration Tests (25%)
         /                        \
      Unit Tests (55%)
```

### Test Categories
- **Unit Tests**: Individual functions and classes
- **Integration Tests**: API endpoints and database operations
- **System Tests**: Complete workflows and timer lifecycles
- **Load Tests**: Performance under high concurrent usage
- **Security Tests**: Authentication, authorization, and data protection

## 🔬 UNIT TESTING

### Timer Core Logic Testing
```javascript
// tests/unit/timer-logic.test.js
const { parseHumanDuration, calculateProgress } = require('../../lib/timer-utils');

describe('Timer Duration Parsing', () => {
  test('should parse human-readable durations', () => {
    expect(parseHumanDuration('5m')).toBe(300000);
    expect(parseHumanDuration('2h 30m')).toBe(9000000);
    expect(parseHumanDuration('1d')).toBe(86400000);
    expect(parseHumanDuration('30s')).toBe(30000);
  });

  test('should handle invalid durations', () => {
    expect(() => parseHumanDuration('invalid')).toThrow('Invalid duration format');
    expect(() => parseHumanDuration('')).toThrow('Duration cannot be empty');
    expect(() => parseHumanDuration('0s')).toThrow('Duration must be positive');
  });

  test('should parse millisecond durations', () => {
    expect(parseHumanDuration(60000)).toBe(60000);
    expect(parseHumanDuration('60000')).toBe(60000);
  });
});

describe('Timer Progress Calculation', () => {
  test('should calculate correct progress percentage', () => {
    const startTime = Date.now() - 30000; // 30 seconds ago
    const duration = 60000; // 1 minute total
    
    const progress = calculateProgress(startTime, duration);
    expect(progress).toBeCloseTo(0.5, 1); // 50% complete
  });

  test('should handle expired timers', () => {
    const startTime = Date.now() - 120000; // 2 minutes ago
    const duration = 60000; // 1 minute total
    
    const progress = calculateProgress(startTime, duration);
    expect(progress).toBe(1.0); // 100% complete (expired)
  });

  test('should handle new timers', () => {
    const startTime = Date.now();
    const duration = 60000;
    
    const progress = calculateProgress(startTime, duration);
    expect(progress).toBeCloseTo(0, 2); // Just started
  });
});
```

### RBAC Permission Testing
```javascript
// tests/unit/rbac.test.js
const { RoleManager } = require('../../functions/rbac-system/core/RoleDefinitions');
const { PermissionChecker } = require('../../functions/rbac-system/core/PermissionChecker');

describe('Role-Based Access Control', () => {
  let roleManager;
  let permissionChecker;

  beforeEach(() => {
    roleManager = new RoleManager();
    permissionChecker = new PermissionChecker();
  });

  describe('Role Hierarchy', () => {
    test('should validate role hierarchy levels', () => {
      expect(roleManager.getRoleLevel('viewer')).toBe(1);
      expect(roleManager.getRoleLevel('editor')).toBe(2);
      expect(roleManager.getRoleLevel('manager')).toBe(3);
      expect(roleManager.getRoleLevel('admin')).toBe(4);
      expect(roleManager.getRoleLevel('owner')).toBe(5);
    });

    test('should check role inheritance correctly', () => {
      expect(roleManager.inheritsFrom('admin', 'manager')).toBe(true);
      expect(roleManager.inheritsFrom('manager', 'editor')).toBe(true);
      expect(roleManager.inheritsFrom('editor', 'admin')).toBe(false);
    });
  });

  describe('Permission Checking', () => {
    test('should allow valid permissions', () => {
      const result = permissionChecker.hasPermission('admin', 'manage_members');
      expect(result).toBe(true);
    });

    test('should deny insufficient permissions', () => {
      const result = permissionChecker.hasPermission('viewer', 'create_timers');
      expect(result).toBe(false);
    });

    test('should check organization-specific permissions', () => {
      const orgAccess = {
        organizationId: 'org_123',
        role: 'manager'
      };
      
      const result = permissionChecker.hasOrgPermission(orgAccess, 'create_projects');
      expect(result).toBe(true);
    });
  });
});
```

## 🔗 INTEGRATION TESTING

### API Endpoint Testing
```javascript
// tests/integration/api.test.js
const request = require('supertest');
const { app } = require('../../functions/index');

describe('Timer API Integration', () => {
  let authToken;
  let timerId;

  beforeAll(async () => {
    // Get test auth token
    authToken = await getTestAuthToken();
  });

  afterEach(async () => {
    // Cleanup created timers
    if (timerId) {
      await request(app)
        .delete(`/timers/${timerId}`)
        .set('Authorization', `Bearer ${authToken}`);
    }
  });

  describe('POST /timers', () => {
    test('should create timer with valid data', async () => {
      const timerData = {
        name: 'Integration Test Timer',
        duration: '5m',
        events: {
          on_expire: {
            webhook: 'https://httpbin.org/post'
          }
        }
      };

      const response = await request(app)
        .post('/timers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(timerData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.timer.id).toBeDefined();
      expect(response.body.timer.name).toBe(timerData.name);
      expect(response.body.timer.status).toBe('running');

      timerId = response.body.timer.id;
    });

    test('should reject invalid duration', async () => {
      const timerData = {
        name: 'Invalid Timer',
        duration: 'invalid_duration'
      };

      const response = await request(app)
        .post('/timers')
        .set('Authorization', `Bearer ${authToken}`)
        .send(timerData)
        .expect(400);

      expect(response.body.error).toContain('Invalid duration format');
    });

    test('should enforce tier limits', async () => {
      // Create multiple timers to exceed free tier limit
      const promises = [];
      for (let i = 0; i < 6; i++) {
        promises.push(
          request(app)
            .post('/timers')
            .set('Authorization', `Bearer ${freeUserToken}`)
            .send({
              name: `Limit Test Timer ${i}`,
              duration: '1h'
            })
        );
      }

      const responses = await Promise.all(promises);
      const lastResponse = responses[responses.length - 1];
      
      expect(lastResponse.status).toBe(403);
      expect(lastResponse.body.error).toContain('Free tier limit');
    });
  });

  describe('GET /timers', () => {
    beforeEach(async () => {
      // Create test timer
      const response = await request(app)
        .post('/timers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'List Test Timer',
          duration: '10m'
        });
      
      timerId = response.body.timer.id;
    });

    test('should list user timers', async () => {
      const response = await request(app)
        .get('/timers')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.timers)).toBe(true);
      expect(response.body.timers.length).toBeGreaterThan(0);
      
      const timer = response.body.timers.find(t => t.id === timerId);
      expect(timer).toBeDefined();
    });

    test('should filter by status', async () => {
      const response = await request(app)
        .get('/timers?status=running')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.timers.every(t => t.status === 'running')).toBe(true);
    });
  });
});
```

### Database Integration Testing
```javascript
// tests/integration/database.test.js
const admin = require('firebase-admin');
const { TimerService } = require('../../functions/services/TimerService');

describe('Firestore Integration', () => {
  let db;
  let timerService;

  beforeAll(async () => {
    // Initialize test Firestore instance
    db = admin.firestore();
    timerService = new TimerService(db);
  });

  afterEach(async () => {
    // Clean up test data
    const batch = db.batch();
    const timers = await db.collection('timers').where('test', '==', true).get();
    timers.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  });

  test('should create timer in Firestore', async () => {
    const timerData = {
      name: 'DB Test Timer',
      duration: 300000,
      userId: 'test_user_123',
      test: true
    };

    const timer = await timerService.createTimer(timerData);
    
    expect(timer.id).toBeDefined();
    expect(timer.createdAt).toBeDefined();

    // Verify in database
    const doc = await db.collection('timers').doc(timer.id).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().name).toBe(timerData.name);
  });

  test('should update timer progress', async () => {
    const timer = await timerService.createTimer({
      name: 'Progress Test',
      duration: 60000,
      userId: 'test_user_123',
      test: true
    });

    await timerService.updateProgress(timer.id, 0.5);

    const updated = await timerService.getTimer(timer.id);
    expect(updated.progress).toBe(0.5);
  });

  test('should handle concurrent updates', async () => {
    const timer = await timerService.createTimer({
      name: 'Concurrency Test',
      duration: 60000,
      userId: 'test_user_123',
      test: true
    });

    // Simulate concurrent updates
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(timerService.updateProgress(timer.id, i / 10));
    }

    await Promise.all(promises);

    const final = await timerService.getTimer(timer.id);
    expect(final.progress).toBeDefined();
  });
});
```

## 🌐 END-TO-END TESTING

### Complete Timer Lifecycle Test
```javascript
// tests/e2e/timer-lifecycle.test.js
const { chromium } = require('playwright');
const { TimerClient } = require('../../sdk/src/TimerClient');

describe('Complete Timer Workflow', () => {
  let browser;
  let page;
  let timerClient;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    timerClient = new TimerClient(process.env.TEST_API_KEY);
  });

  afterAll(async () => {
    await browser.close();
  });

  test('should complete full timer workflow', async () => {
    // Step 1: Create timer via API
    const timer = await timerClient.create({
      name: 'E2E Test Timer',
      duration: '30s',
      events: {
        on_expire: {
          webhook: 'https://webhook-test.com/e2e-test'
        }
      }
    });

    expect(timer.id).toBeDefined();
    expect(timer.status).toBe('running');

    // Step 2: Monitor progress
    let progress = 0;
    while (progress < 1.0) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      const current = await timerClient.get(timer.id);
      progress = current.progress;
      
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1.0);
    }

    // Step 3: Verify timer completion
    const completed = await timerClient.get(timer.id);
    expect(completed.status).toBe('expired');
    expect(completed.progress).toBe(1.0);
    expect(completed.expiredAt).toBeDefined();

    // Step 4: Verify webhook was called (check logs or mock service)
    // This would depend on your webhook testing setup
  });

  test('should handle timer deletion', async () => {
    const timer = await timerClient.create({
      name: 'Delete Test Timer',
      duration: '5m'
    });

    const deleted = await timerClient.delete(timer.id);
    expect(deleted.success).toBe(true);

    // Verify timer is gone
    await expect(timerClient.get(timer.id)).rejects.toThrow('Timer not found');
  });
});
```

## 🚀 LOAD TESTING

### Performance Testing with Artillery
```yaml
# tests/load/timer-load-test.yml
config:
  target: 'https://api-m3waemr5lq-uc.a.run.app'
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Load test"
    - duration: 60
      arrivalRate: 100
      name: "Spike test"
  variables:
    apiKey: "{{ $env.LOAD_TEST_API_KEY }}"

scenarios:
  - name: "Create and monitor timers"
    weight: 70
    flow:
      - post:
          url: "/timers"
          headers:
            x-api-key: "{{ apiKey }}"
          json:
            name: "Load Test Timer {{ $randomString() }}"
            duration: "{{ $randomInt(60, 300) }}s"
          capture:
            - json: "$.timer.id"
              as: "timerId"
      - get:
          url: "/timers/{{ timerId }}"
          headers:
            x-api-key: "{{ apiKey }}"

  - name: "List timers"
    weight: 20
    flow:
      - get:
          url: "/timers"
          headers:
            x-api-key: "{{ apiKey }}"

  - name: "Quick timers"
    weight: 10
    flow:
      - post:
          url: "/quick/wait"
          headers:
            x-api-key: "{{ apiKey }}"
          json:
            duration: "{{ $randomInt(10, 60) }}s"
```

### Load Testing Execution
```bash
# Install Artillery
npm install -g artillery

# Run load tests
artillery run tests/load/timer-load-test.yml

# Generate detailed report
artillery run tests/load/timer-load-test.yml --output results.json
artillery report results.json
```

## 🔒 SECURITY TESTING

### Authentication Testing
```javascript
// tests/security/auth.test.js
describe('Authentication Security', () => {
  test('should reject requests without API key', async () => {
    const response = await request(app)
      .post('/timers')
      .send({
        name: 'Unauthorized Timer',
        duration: '5m'
      })
      .expect(401);

    expect(response.body.error).toContain('API key required');
  });

  test('should reject invalid API key format', async () => {
    const response = await request(app)
      .post('/timers')
      .set('x-api-key', 'invalid_key_format')
      .send({
        name: 'Invalid Key Timer',
        duration: '5m'
      })
      .expect(401);

    expect(response.body.error).toContain('Invalid API key');
  });

  test('should enforce rate limits', async () => {
    const requests = [];
    
    // Make many requests quickly
    for (let i = 0; i < 100; i++) {
      requests.push(
        request(app)
          .get('/timers')
          .set('x-api-key', TEST_API_KEY)
      );
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);
    
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

### Input Validation Testing
```javascript
// tests/security/validation.test.js
describe('Input Validation Security', () => {
  test('should sanitize timer names', async () => {
    const maliciousData = {
      name: '<script>alert("xss")</script>',
      duration: '5m'
    };

    const response = await request(app)
      .post('/timers')
      .set('Authorization', `Bearer ${authToken}`)
      .send(maliciousData)
      .expect(201);

    expect(response.body.timer.name).not.toContain('<script>');
  });

  test('should reject SQL injection attempts', async () => {
    const maliciousData = {
      name: "'; DROP TABLE timers; --",
      duration: '5m'
    };

    const response = await request(app)
      .post('/timers')
      .set('Authorization', `Bearer ${authToken}`)
      .send(maliciousData)
      .expect(400);

    expect(response.body.error).toContain('Invalid characters');
  });

  test('should enforce maximum payload size', async () => {
    const largeData = {
      name: 'Large Timer',
      duration: '5m',
      description: 'x'.repeat(10000) // 10KB description
    };

    const response = await request(app)
      .post('/timers')
      .set('Authorization', `Bearer ${authToken}`)
      .send(largeData)
      .expect(413);

    expect(response.body.error).toContain('Payload too large');
  });
});
```

## 🤖 AUTOMATED TESTING

### CI/CD Pipeline (GitHub Actions)
```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      firestore-emulator:
        image: google/cloud-sdk:latest
        ports:
          - 8080:8080
        options: >-
          --entrypoint gcloud
          beta
          emulators
          firestore
          start
          --host-port=0.0.0.0:8080

    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: |
        npm ci
        cd functions && npm ci && cd ..
        cd sdk && npm ci && cd ..
    
    - name: Run unit tests
      run: npm run test:unit
    
    - name: Run integration tests
      run: npm run test:integration
      env:
        FIRESTORE_EMULATOR_HOST: localhost:8080
    
    - name: Run security tests
      run: npm run test:security
    
    - name: Generate test coverage
      run: npm run test:coverage
    
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/lcov.info
    
    - name: Run load tests
      run: npm run test:load
      if: github.ref == 'refs/heads/main'
```

### Test Scripts (package.json)
```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "jest tests/e2e",
    "test:security": "jest tests/security",
    "test:load": "artillery run tests/load/timer-load-test.yml",
    "test:coverage": "jest --coverage",
    "test:watch": "jest --watch",
    "test:ci": "jest --ci --coverage --watchAll=false"
  }
}
```

## 📊 TEST REPORTING

### Coverage Requirements
```javascript
// jest.config.js
module.exports = {
  collectCoverageFrom: [
    'functions/**/*.js',
    'sdk/src/**/*.js',
    '!**/node_modules/**',
    '!**/coverage/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  testMatch: [
    '**/tests/**/*.test.js'
  ]
};
```

### Test Execution Summary
```bash
# Run all tests with reporting
npm run test:ci

# Expected output:
# ✅ Unit Tests: 47 passed
# ✅ Integration Tests: 23 passed  
# ✅ Security Tests: 15 passed
# ✅ Coverage: 85% (Above threshold)
# ⚠️  Load Tests: Performance within limits
```

## 🎯 TESTING BEST PRACTICES

### Test Organization
- **Arrange-Act-Assert**: Clear test structure
- **One assertion per test**: Single responsibility
- **Descriptive test names**: What is being tested and expected outcome
- **Test isolation**: Each test can run independently
- **Mock external dependencies**: Control test environment

### Data Management
- **Test data factories**: Generate consistent test data
- **Database seeding**: Predictable initial state
- **Cleanup after tests**: No test pollution
- **Separate test database**: Never test against production

### Performance Testing
- **Establish baselines**: Know your normal performance
- **Test realistic scenarios**: Real user patterns
- **Monitor resource usage**: CPU, memory, database connections
- **Test gradual load increases**: Find breaking points

### Security Testing
- **Test all input vectors**: Every field that accepts data
- **Verify authorization**: Users can only access their data
- **Test rate limiting**: Prevent abuse
- **Validate error messages**: Don't leak sensitive information

## 🚨 TESTING CHECKLIST

### Before Every Release
- [ ] All unit tests passing
- [ ] Integration tests complete
- [ ] Security tests verified
- [ ] Load testing under expected traffic
- [ ] Error handling tested
- [ ] Database migration tested
- [ ] API documentation updated
- [ ] Test coverage above 80%
- [ ] Performance benchmarks met
- [ ] Security scan completed