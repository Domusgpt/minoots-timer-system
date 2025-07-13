/**
 * MINOOTS SDK - Test Suite
 * Comprehensive tests for all SDK functionality
 */

const MinootsSDK = require('../minoots-sdk.js');

class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
        this.sdk = new MinootsSDK({
            agentId: 'test_agent',
            team: 'sdk_test_team'
        });
    }

    test(name, testFn) {
        this.tests.push({ name, testFn });
    }

    async assert(condition, message) {
        if (!condition) {
            throw new Error(`Assertion failed: ${message}`);
        }
    }

    async assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(`Assertion failed: ${message}. Expected: ${expected}, Got: ${actual}`);
        }
    }

    async assertExists(value, message) {
        if (value === null || value === undefined) {
            throw new Error(`Assertion failed: ${message}. Value does not exist.`);
        }
    }

    async run() {
        console.log(`🧪 Running ${this.tests.length} SDK tests...\n`);

        for (const test of this.tests) {
            try {
                console.log(`Testing: ${test.name}`);
                await test.testFn();
                console.log(`✅ PASS: ${test.name}\n`);
                this.passed++;
            } catch (error) {
                console.log(`❌ FAIL: ${test.name}`);
                console.log(`   Error: ${error.message}\n`);
                this.failed++;
            }
        }

        this.printSummary();
    }

    printSummary() {
        const total = this.passed + this.failed;
        console.log('📊 Test Summary');
        console.log('===============');
        console.log(`Total Tests: ${total}`);
        console.log(`Passed: ${this.passed}`);
        console.log(`Failed: ${this.failed}`);
        console.log(`Success Rate: ${Math.round((this.passed / total) * 100)}%`);

        if (this.failed > 0) {
            console.log('\n❌ Some tests failed. Check the output above for details.');
            process.exit(1);
        } else {
            console.log('\n✅ All tests passed!');
        }
    }
}

// Test suite
const runner = new TestRunner();

// Test 1: SDK initialization
runner.test('SDK Initialization', async () => {
    await runner.assertExists(runner.sdk, 'SDK should be initialized');
    await runner.assertEqual(runner.sdk.defaultAgentId, 'test_agent', 'Agent ID should be set');
    await runner.assertEqual(runner.sdk.defaultTeam, 'sdk_test_team', 'Team should be set');
});

// Test 2: Health check
runner.test('Health Check', async () => {
    const health = await runner.sdk.health();
    await runner.assert(health.status === 'healthy', 'API should be healthy');
    await runner.assertExists(health.timestamp, 'Health response should have timestamp');
    await runner.assertExists(health.service, 'Health response should have service name');
});

// Test 3: Duration parsing
runner.test('Duration Parsing', async () => {
    await runner.assertEqual(runner.sdk.parseDuration('5s'), 5000, '5s should be 5000ms');
    await runner.assertEqual(runner.sdk.parseDuration('2m'), 120000, '2m should be 120000ms');
    await runner.assertEqual(runner.sdk.parseDuration('1h'), 3600000, '1h should be 3600000ms');
    await runner.assertEqual(runner.sdk.parseDuration(10000), 10000, 'Number should pass through');
});

// Test 4: Time formatting
runner.test('Time Formatting', async () => {
    await runner.assertEqual(runner.sdk.formatTimeRemaining(5000), '5s', '5000ms should format as 5s');
    await runner.assertEqual(runner.sdk.formatTimeRemaining(65000), '1m 5s', '65000ms should format as 1m 5s');
    await runner.assertEqual(runner.sdk.formatTimeRemaining(3665000), '1h 1m 5s', '3665000ms should format as 1h 1m 5s');
});

// Test 5: Timer creation
runner.test('Timer Creation', async () => {
    const result = await runner.sdk.createTimer({
        name: 'test_timer_creation',
        duration: '10s',
        metadata: { test: true }
    });

    await runner.assert(result.success, 'Timer creation should succeed');
    await runner.assertExists(result.timer, 'Result should have timer object');
    await runner.assertExists(result.timer.id, 'Timer should have ID');
    await runner.assertEqual(result.timer.name, 'test_timer_creation', 'Timer name should match');
    await runner.assertEqual(result.timer.status, 'running', 'Timer should be running');
    
    // Store for later tests
    runner.createdTimerId = result.timer.id;
});

// Test 6: Timer retrieval
runner.test('Timer Retrieval', async () => {
    await runner.assert(runner.createdTimerId, 'Should have created timer ID from previous test');
    
    const result = await runner.sdk.getTimer(runner.createdTimerId);
    await runner.assert(result.success, 'Timer retrieval should succeed');
    await runner.assertExists(result.timer, 'Result should have timer object');
    await runner.assertEqual(result.timer.id, runner.createdTimerId, 'Timer ID should match');
    await runner.assertExists(result.timer.timeRemaining, 'Timer should have timeRemaining');
    await runner.assertExists(result.timer.progress, 'Timer should have progress');
});

// Test 7: Timer listing
runner.test('Timer Listing', async () => {
    const result = await runner.sdk.listTimers();
    await runner.assert(result.success, 'Timer listing should succeed');
    await runner.assertExists(result.timers, 'Result should have timers array');
    await runner.assertExists(result.count, 'Result should have count');
    await runner.assert(Array.isArray(result.timers), 'Timers should be an array');
    await runner.assert(result.count >= 1, 'Should have at least 1 timer');
});

// Test 8: Quick wait timer
runner.test('Quick Wait Timer', async () => {
    const result = await runner.sdk.quickWait('5s', {
        name: 'test_quick_wait'
    });

    await runner.assert(result.success, 'Quick wait should succeed');
    await runner.assertExists(result.timer, 'Result should have timer object');
    await runner.assertEqual(result.timer.name, 'test_quick_wait', 'Timer name should match');
});

// Test 9: Team broadcast
runner.test('Team Broadcast', async () => {
    const result = await runner.sdk.broadcastToTeam('sdk_test_team', 'Test broadcast message', {
        test: true,
        timestamp: Date.now()
    });

    await runner.assert(result.success, 'Broadcast should succeed');
    await runner.assertExists(result.broadcast, 'Result should have broadcast object');
    await runner.assertEqual(result.broadcast.team, 'sdk_test_team', 'Team should match');
    await runner.assertEqual(result.broadcast.message, 'Test broadcast message', 'Message should match');
});

// Test 10: Timer with webhook
runner.test('Timer with Webhook', async () => {
    const result = await runner.sdk.createTimerWithWebhook({
        name: 'test_webhook_timer',
        duration: '3s',
        webhook: 'https://httpbin.org/post',
        message: 'Test webhook message',
        data: { test: true }
    });

    await runner.assert(result.success, 'Webhook timer creation should succeed');
    await runner.assertExists(result.timer, 'Result should have timer object');
    await runner.assertEqual(result.timer.name, 'test_webhook_timer', 'Timer name should match');
});

// Test 11: Filtered timer listing
runner.test('Filtered Timer Listing', async () => {
    const result = await runner.sdk.listTimers({
        agentId: 'test_agent',
        team: 'sdk_test_team'
    });

    await runner.assert(result.success, 'Filtered listing should succeed');
    await runner.assertExists(result.timers, 'Result should have timers array');
    
    // All timers should belong to our agent/team
    result.timers.forEach(timer => {
        if (timer.agentId && timer.agentId !== 'test_agent') {
            throw new Error(`Timer ${timer.id} has wrong agentId: ${timer.agentId}`);
        }
    });
});

// Test 12: Error handling
runner.test('Error Handling', async () => {
    try {
        // Try to get non-existent timer
        await runner.sdk.getTimer('non-existent-timer-id');
        throw new Error('Should have thrown an error for non-existent timer');
    } catch (error) {
        await runner.assert(error.message.includes('Timer not found'), 'Should get proper error message');
    }

    try {
        // Try invalid duration
        runner.sdk.parseDuration('invalid');
        throw new Error('Should have thrown an error for invalid duration');
    } catch (error) {
        await runner.assert(error.message.includes('Invalid duration'), 'Should get proper error message');
    }
});

// Run tests
if (require.main === module) {
    runner.run().then(() => {
        console.log('\n🎉 SDK test suite completed successfully!');
    }).catch(error => {
        console.error('❌ Test suite failed:', error.message);
        process.exit(1);
    });
}

module.exports = TestRunner;