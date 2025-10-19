const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createFakeFirestore,
  configureAdmin,
} = require('./support/fakeFirestore');

const webhooks = require('../utils/webhooks');
const { __testHooks } = require('../index.js');
const { overrideDb, admin } = __testHooks;

const fakeDb = createFakeFirestore();
overrideDb(fakeDb);
configureAdmin(admin, fakeDb);
webhooks.__setDb(fakeDb);

let originalFetch;

beforeEach(() => {
  fakeDb.reset();
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('webhook event delivers payload and logs success', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response('ok', { status: 200 });
  };

  const { webhook, secret } = await webhooks.registerWebhook('team-alpha', {
    url: 'https://example.com/hook',
    description: 'Primary hook',
    events: ['timer.expired'],
  });

  const list = await webhooks.listWebhooks('team-alpha');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, webhook.id);
  assert.ok(!('secret' in list[0]));

  await webhooks.publishEvent('team-alpha', 'timer.expired', { timerId: 't-1' });
  const summary = await webhooks.dispatchQueuedDeliveries({ limit: 5 });
  assert.equal(summary.processed, 1);
  assert.equal(summary.delivered, 1);

  assert.ok(request, 'expected webhook to be invoked');
  const signatureHeader = request.options.headers['x-minoots-signature'];
  assert.ok(signatureHeader);
  const payloadString = request.options.body;
  assert.ok(
    webhooks.verifySignature(secret, signatureHeader, payloadString),
    'signature should verify'
  );

  const logs = await webhooks.getWebhookLogs('team-alpha', webhook.id, { limit: 5 });
  assert.equal(logs.entries.length, 1);
  assert.equal(logs.entries[0].status, 'delivered');
});

test('failing delivery schedules retry and eventually succeeds', async () => {
  let attempt = 0;
  global.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error('network offline');
    }
    return new Response('ok', { status: 200 });
  };

  const { webhook } = await webhooks.registerWebhook('team-beta', {
    url: 'https://retry.example.com',
    events: ['timer.created'],
  });

  await webhooks.publishEvent('team-beta', 'timer.created', { timerId: 'retry-me' });
  const first = await webhooks.dispatchQueuedDeliveries({ limit: 5 });
  assert.equal(first.processed, 1);
  assert.equal(first.retried, 1);

  const queueSnapshot = await fakeDb.collection('webhook_queue').get();
  assert.equal(queueSnapshot.size, 1, 'a retry should remain queued');

  const second = await webhooks.dispatchQueuedDeliveries({ limit: 5 });
  assert.equal(second.processed, 1);
  assert.equal(second.delivered, 1);

  const logs = await webhooks.getWebhookLogs('team-beta', webhook.id, { limit: 10 });
  assert.equal(logs.entries.length, 2);
  const statuses = logs.entries.map((entry) => entry.status);
  assert.ok(statuses.includes('error'));
  assert.ok(statuses.includes('delivered'));
});

test('updating webhook can rotate secret', async () => {
  const { webhook, secret } = await webhooks.registerWebhook('team-rotate', {
    url: 'https://rotate.example.com',
  });
  assert.ok(secret);

  const update = await webhooks.updateWebhook('team-rotate', webhook.id, {
    description: 'updated',
    rotateSecret: true,
  });

  assert.equal(update.webhook.description, 'updated');
  assert.ok(update.secret);
  assert.notEqual(update.secret, secret);
});
