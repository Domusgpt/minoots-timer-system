/**
 * MINOOTS SDK - Test Suite
 * Modernized tests using a fetch stub to validate SDK behavior without hitting the live API.
 */

const MinootsSDK = require('../minoots-sdk.js');
const { MinootsAPIError } = MinootsSDK;

class MockFetch {
    constructor() {
        this.routes = new Map();
        this.calls = [];
    }

    respond(method, path, handler) {
        const key = this._key(method, path);
        const value = Array.isArray(handler) ? handler.slice() : handler;
        this.routes.set(key, value);
    }

    respondSequence(method, path, handlers) {
        this.respond(method, path, handlers);
    }

    _key(method, path) {
        return `${method.toUpperCase()} ${path}`;
    }

    async fetch(input, init = {}) {
        const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
        const method = (init.method || 'GET').toUpperCase();
        const key = this._key(method, url.pathname);

        const route = this.routes.get(key);
        let handler = route;
        if (Array.isArray(route)) {
            if (route.length === 0) {
                throw new Error(`No more mock responses configured for ${method} ${url.pathname}`);
            }
            handler = route.shift();
            this.routes.set(key, route);
        }

        if (!handler) {
            throw new Error(`No mock response configured for ${method} ${url.pathname}`);
        }

        const headersInstance = new Headers(init.headers || {});
        const headers = {};
        headersInstance.forEach((value, headerName) => {
            headers[headerName.toLowerCase()] = value;
        });

        let body = undefined;
        if (init.body) {
            try {
                body = JSON.parse(init.body);
            } catch (error) {
                body = init.body;
            }
        }

        const context = { url, init, headers, body, method };
        const responseConfig = typeof handler === 'function' ? handler(context, this) : handler;
        const status = responseConfig.status || 200;
        const responseHeaders = responseConfig.headers || { 'content-type': 'application/json' };
        const responseBody = responseConfig.body !== undefined ? responseConfig.body : {};
        const serializedBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);

        this.calls.push({
            method,
            url: url.toString(),
            path: url.pathname,
            headers,
            body,
            status,
        });

        return new Response(serializedBody, { status, headers: responseHeaders });
    }
}

class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
        this.mockFetch = new MockFetch();
        this.sdk = new MinootsSDK({
            agentId: 'test_agent',
            team: 'sdk_test_team',
            apiKey: 'test-api-key',
            timeout: 5000,
            fetch: this.mockFetch.fetch.bind(this.mockFetch),
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

const runner = new TestRunner();

// Configure mock responses
const now = Date.now();
const parseratorSource = {
    id: 'src-1',
    teamId: 'sdk_test_team',
    name: 'Parser Bridge',
    webhookUrlPath: '/parserator/webhook?source=src-1',
};

runner.mockFetch.respond('GET', '/health', {
    body: { status: 'healthy', timestamp: now, service: 'minoots-control-plane' },
});

runner.mockFetch.respond('POST', '/timers', ({ body }) => {
    if (body && body.name === 'fail_me') {
        return { status: 400, body: { error: 'Bad timer payload' } };
    }

    return {
        body: {
            success: true,
            timer: {
                id: 'timer-123',
                name: body.name,
                status: 'running',
                duration: body.duration,
                timeRemaining: 9000,
                progress: 0,
                agent_id: body.agent_id,
                team: body.team,
            },
        },
    };
});

runner.mockFetch.respond('GET', '/timers/timer-123', {
    body: {
        success: true,
        timer: {
            id: 'timer-123',
            name: 'test_timer_creation',
            status: 'running',
            timeRemaining: 8000,
            progress: 0.25,
        },
    },
});

runner.mockFetch.respond('GET', '/teams/sdk_test_team/parserator/sources', {
    body: { sources: [parseratorSource] },
});

runner.mockFetch.respond('POST', '/teams/sdk_test_team/parserator/sources', ({ body }) => ({
    body: { source: { ...parseratorSource, name: body.name || parseratorSource.name } },
}));

runner.mockFetch.respond('GET', '/teams/sdk_test_team/parserator/sources/src-1', {
    body: { source: parseratorSource },
});

runner.mockFetch.respond('PATCH', '/teams/sdk_test_team/parserator/sources/src-1', ({ body }) => ({
    body: { source: { ...parseratorSource, ...body } },
}));

runner.mockFetch.respond('POST', '/teams/sdk_test_team/parserator/sources/src-1/rotate-secret', {
    body: { source: { ...parseratorSource, webhookSecret: 'newsecret' } },
});

runner.mockFetch.respond('DELETE', '/teams/sdk_test_team/parserator/sources/src-1', {
    body: { success: true, eventsDeleted: 4, actionsDeleted: 7 },
});

runner.mockFetch.respond('POST', '/teams/sdk_test_team/parserator/sources/src-1/preview', ({ body }) => ({
    body: {
        actions: [
            {
                type: 'timer',
                timer: { name: 'Preview Timer', metadata: { sample: body.sample } },
                scheduledFor: '2025-01-01T00:00:00Z',
                insights: [],
            },
        ],
    },
}));

runner.mockFetch.respond('GET', '/teams/sdk_test_team/parserator/events', {
    body: { events: [{ id: 'evt-1', status: 'queued', sourceId: 'src-1', teamId: 'sdk_test_team' }] },
});

runner.mockFetch.respond('GET', '/teams/sdk_test_team/parserator/actions', {
    body: { actions: [{ id: 'act-1', status: 'pending', sourceId: 'src-1', teamId: 'sdk_test_team', eventId: 'evt-1' }] },
});

runner.mockFetch.respond('POST', '/teams/sdk_test_team/parserator/actions/act-1/status', ({ body }) => ({
    body: { action: { id: 'act-1', status: body.status || 'completed', sourceId: 'src-1', teamId: 'sdk_test_team', eventId: 'evt-1' } },
}));

runner.mockFetch.respond('POST', '/teams/sdk_test_team/parserator/actions/act-1/replay', ({ body }) => ({
    body: { action: { id: body.id || 'act-replay', status: 'pending', scheduledFor: body.scheduledFor || null } },
}));

runner.mockFetch.respond('GET', '/timers', {
    body: {
        success: true,
        count: 1,
        timers: [
            {
                id: 'timer-123',
                name: 'test_timer_creation',
                status: 'running',
            },
        ],
    },
});

runner.mockFetch.respond('POST', '/quick/wait', ({ body }) => ({
    body: {
        success: true,
        timer: {
            id: 'quick-id',
            name: body.name,
            status: 'running',
            timeRemaining: 5000,
        },
    },
}));

runner.mockFetch.respondSequence('GET', '/timers/quick-id', [
    {
        body: {
            success: true,
            timer: {
                id: 'quick-id',
                status: 'running',
                timeRemaining: 2000,
            },
        },
    },
    {
        body: {
            success: true,
            timer: {
                id: 'quick-id',
                status: 'expired',
                timeRemaining: 0,
            },
        },
    },
]);

runner.mockFetch.respondSequence('GET', '/timers/poll-id', [
    {
        body: {
            success: true,
            timer: {
                id: 'poll-id',
                status: 'running',
                timeRemaining: 1500,
            },
        },
    },
    {
        body: {
            success: true,
            timer: {
                id: 'poll-id',
                status: 'settled',
                timeRemaining: 0,
            },
        },
    },
]);

runner.mockFetch.respondSequence('GET', '/timers/retry-123', [
    { status: 500, body: { error: 'temporary failure' } },
    {
        body: {
            success: true,
            timer: {
                id: 'retry-123',
                status: 'completed',
                timeRemaining: 0,
            },
        },
    },
]);

runner.mockFetch.respondSequence('GET', '/timers/retry-fail', [
    { status: 503, body: { error: 'still down' } },
    { status: 503, body: { error: 'still down' } },
    { status: 503, body: { error: 'still down' } },
]);

// Tests
runner.test('SDK Initialization and API key propagation', async () => {
    await runner.assertExists(runner.sdk, 'SDK should be initialized');
    await runner.assertEqual(runner.sdk.defaultAgentId, 'test_agent', 'Agent ID should be set');
    await runner.assertEqual(runner.sdk.defaultTeam, 'sdk_test_team', 'Team should be set');

    const call = runner.mockFetch.calls[0];
    if (call) {
        await runner.assertEqual(call.headers['x-api-key'], 'test-api-key', 'API key header should be applied');
    }
});

runner.test('Health Check', async () => {
    const health = await runner.sdk.health();
    await runner.assertEqual(health.status, 'healthy', 'API should be healthy');
    await runner.assertExists(health.timestamp, 'Health response should have timestamp');
    await runner.assertExists(health.service, 'Health response should have service name');
});

runner.test('Duration Parsing', async () => {
    await runner.assertEqual(runner.sdk.parseDuration('5s'), 5000, '5s should be 5000ms');
    await runner.assertEqual(runner.sdk.parseDuration('2m'), 120000, '2m should be 120000ms');
    await runner.assertEqual(runner.sdk.parseDuration('1h'), 3600000, '1h should be 3600000ms');
    await runner.assertEqual(runner.sdk.parseDuration(10000), 10000, 'Number should pass through');
});

runner.test('Time Formatting', async () => {
    await runner.assertEqual(runner.sdk.formatTimeRemaining(5000), '5s', '5000ms should format as 5s');
    await runner.assertEqual(runner.sdk.formatTimeRemaining(65000), '1m 5s', '65000ms should format as 1m 5s');
    await runner.assertEqual(runner.sdk.formatTimeRemaining(3665000), '1h 1m 5s', '3665000ms should format as 1h 1m 5s');
});

runner.test('Timer Creation', async () => {
    const result = await runner.sdk.createTimer({
        name: 'test_timer_creation',
        duration: '10s',
        metadata: { test: true },
    });

    await runner.assert(result.success, 'Timer creation should succeed');
    await runner.assertExists(result.timer, 'Result should have timer object');
    await runner.assertExists(result.timer.id, 'Timer should have ID');
    await runner.assertEqual(result.timer.name, 'test_timer_creation', 'Timer name should match');
    await runner.assertEqual(result.timer.status, 'running', 'Timer should be running');
});

runner.test('Timer Retrieval', async () => {
    const result = await runner.sdk.getTimer('timer-123');
    await runner.assert(result.success, 'Timer retrieval should succeed');
    await runner.assertExists(result.timer, 'Result should have timer object');
    await runner.assertEqual(result.timer.id, 'timer-123', 'Timer ID should match');
    await runner.assertExists(result.timer.timeRemaining, 'Timer should have timeRemaining');
    await runner.assertExists(result.timer.progress, 'Timer should have progress');
});

runner.test('Timer Listing', async () => {
    const result = await runner.sdk.listTimers({ agentId: 'test_agent' });
    await runner.assert(result.success, 'Timer listing should succeed');
    await runner.assertExists(result.timers, 'Result should have timers array');
    await runner.assertExists(result.count, 'Result should have count');
    await runner.assert(Array.isArray(result.timers), 'Timers should be an array');
    await runner.assert(result.count >= 1, 'Should have at least 1 timer');
});

runner.test('Quick Wait Timer and waitFor helper', async () => {
    const result = await runner.sdk.quickWait('5s', {
        name: 'test_quick_wait',
    });

    await runner.assert(result.success, 'Quick wait should succeed');
    await runner.assertExists(result.timer, 'Result should have timer object');
    await runner.assertEqual(result.timer.name, 'test_quick_wait', 'Timer name should match');

    const completedTimer = await runner.sdk.waitFor('5s', { pollIntervalMs: 5 });
    await runner.assertEqual(completedTimer.status, 'expired', 'waitFor should resolve when timer expires');
});

runner.test('pollTimer resolves when timer completes', async () => {
    const timer = await runner.sdk.pollTimer('poll-id', 5);
    await runner.assertEqual(timer.status, 'settled', 'pollTimer should resolve with final timer');
});

runner.test('API errors propagate as MinootsAPIError', async () => {
    let errorCaught = false;
    try {
        await runner.sdk.createTimer({
            name: 'fail_me',
            duration: '5s',
        });
    } catch (error) {
        errorCaught = error instanceof MinootsAPIError;
    }

    await runner.assert(errorCaught, 'MinootsAPIError should be thrown for API failures');
});

runner.test('Retry logic triggers on configured status codes', async () => {
    const retryingSdk = runner.sdk.withRetry({ attempts: 2, minTimeout: 1, maxTimeout: 2, jitter: false });
    let beforeCount = 0;
    let afterCount = 0;
    let retryCount = 0;

    retryingSdk.hooks.beforeRequest.push(() => { beforeCount += 1; });
    retryingSdk.hooks.afterResponse.push(() => { afterCount += 1; });
    retryingSdk.hooks.onRetry.push(() => { retryCount += 1; });

    const result = await retryingSdk.getTimer('retry-123');

    await runner.assertEqual(result.timer.id, 'retry-123', 'Timer ID should match after retry');
    await runner.assertEqual(beforeCount, 2, 'beforeRequest hook should run twice');
    await runner.assertEqual(afterCount, 2, 'afterResponse hook should run twice');
    await runner.assertEqual(retryCount, 1, 'onRetry hook should run once');
});

runner.test('Retry stops after configured attempts', async () => {
    const retryingSdk = runner.sdk.withRetry({
        attempts: 2,
        minTimeout: 1,
        maxTimeout: 2,
        jitter: false,
        retryOn: [503],
    });

    let errorCaught = false;
    try {
        await retryingSdk.getTimer('retry-fail');
    } catch (error) {
        errorCaught = error instanceof MinootsAPIError;
    }

    await runner.assert(errorCaught, 'Retry exhaustion should throw the final API error');
});

runner.test('Parserator source lifecycle helpers', async () => {
    const sources = await runner.sdk.listParseratorSources();
    await runner.assert(Array.isArray(sources), 'Sources should be an array');
    await runner.assertEqual(sources[0].id, 'src-1', 'First source ID should match');

    const created = await runner.sdk.createParseratorSource(undefined, { name: 'Parserator Ingest' });
    await runner.assertEqual(created.name, 'Parserator Ingest', 'Created source should echo requested name');

    const fetched = await runner.sdk.getParseratorSource(undefined, 'src-1');
    await runner.assertEqual(fetched.id, 'src-1', 'Fetched source should match ID');

    const updated = await runner.sdk.updateParseratorSource(undefined, 'src-1', { description: 'Updated mapping' });
    await runner.assertEqual(updated.description, 'Updated mapping', 'Updated source should reflect description change');

    const rotated = await runner.sdk.rotateParseratorSourceSecret(undefined, 'src-1');
    await runner.assertEqual(rotated.webhookSecret, 'newsecret', 'Rotate secret should return new secret');

    const preview = await runner.sdk.previewParseratorSource(undefined, 'src-1', { sample: true });
    await runner.assert(Array.isArray(preview) && preview.length === 1, 'Preview should return at least one action');

    const deleted = await runner.sdk.deleteParseratorSource(undefined, 'src-1');
    await runner.assertEqual(deleted.eventsDeleted, 4, 'Delete should report event deletions');
    await runner.assertEqual(deleted.actionsDeleted, 7, 'Delete should report action deletions');
});

runner.test('Parserator events and actions management', async () => {
    const events = await runner.sdk.listParseratorEvents();
    await runner.assertEqual(events[0].id, 'evt-1', 'First event should match mock response');

    const actions = await runner.sdk.listParseratorActions();
    await runner.assertEqual(actions[0].id, 'act-1', 'First action should match mock response');

    const updated = await runner.sdk.updateParseratorActionStatus(undefined, 'act-1', { status: 'completed' });
    await runner.assertEqual(updated.status, 'completed', 'Action status should be updated to completed');

    const replayed = await runner.sdk.replayParseratorAction(undefined, 'act-1', { id: 'act-replay', scheduledFor: '2025-01-02T00:00:00Z' });
    await runner.assertEqual(replayed.id, 'act-replay', 'Replay should return cloned action id');
    await runner.assertEqual(replayed.status, 'pending', 'Replay should return pending status');
});

runner.run();
