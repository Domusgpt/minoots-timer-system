const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createFakeFirestore,
  configureAdmin,
} = require('./support/fakeFirestore');

const { __testHooks } = require('../index.js');
const { RealTimer, overrideDb, admin } = __testHooks;

const fakeDb = createFakeFirestore();
overrideDb(fakeDb);
configureAdmin(admin, fakeDb);

let originalFetch;

beforeEach(() => {
  fakeDb.reset();
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function createResponse(status = 200, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('successful expiration posts webhook payload and records team metrics', async () => {
  let webhookRequest;
  global.fetch = async (url, options) => {
    webhookRequest = { url, options };
    return createResponse(200, { ok: true });
  };

  const timer = await RealTimer.create({
    name: 'success-timer',
    duration: 50,
    team: 'team-123',
    events: {
      on_expire: {
        webhook: 'https://example.com/hook',
        message: 'done',
        data: { important: true },
      },
    },
  });

  await RealTimer.expire(timer.id);

  assert.ok(webhookRequest, 'expected webhook to be invoked');
  const payload = JSON.parse(webhookRequest.options.body);
  assert.equal(payload.event, 'timer_expired');
  assert.equal(payload.timer.id, timer.id);

  const metricsSnap = await fakeDb
    .collection('teams')
    .doc('team-123')
    .collection('metrics')
    .get();
  assert.equal(metricsSnap.size, 1);
});

test('failed expiration enqueues replay and scheduler replays timer', async () => {
  global.fetch = async () => {
    throw new Error('network failure');
  };

  const timer = await RealTimer.create({
    name: 'failing-timer',
    duration: 25,
    team: 'team-queue',
    events: {
      on_expire: {
        webhook: 'https://example.com/fail',
        message: 'should retry',
      },
    },
  });

  await RealTimer.expire(timer.id);

  const queueSnapshot = await fakeDb
    .collection('timer_replay_queue')
    .where('timerId', '==', timer.id)
    .get();
  assert.equal(queueSnapshot.size, 1, 'expected timer to be queued for replay');

  global.fetch = async () => createResponse(200, { ok: true });

  const processed = await RealTimer.processReplayQueue({ limit: 5 });
  assert.equal(processed.length, 1, 'expected replay queue to process one entry');

  const replayLog = await fakeDb.collection('timer_replays').get();
  assert.equal(replayLog.size, 1, 'expected replay history entry');
  const replayedTimerId = processed[0].replayTimerId;
  const replayedDoc = await fakeDb.collection('timers').doc(replayedTimerId).get();
  assert.ok(replayedDoc.exists, 'replayed timer should exist in timers collection');
});

test('cascade delete removes logs, metrics, and queue entries with counts recorded', async () => {
  global.fetch = async () => createResponse(200, {});

  const timer = await RealTimer.create({
    name: 'cleanup-me',
    duration: 10,
    team: 'team-clean',
    events: {
      on_expire: {
        webhook: 'https://example.com/good',
      },
    },
  });

  await RealTimer.expire(timer.id);
  const stored = await RealTimer.get(timer.id);
  await RealTimer.enqueueReplay({ id: timer.id, ...stored }, {
    reason: 'manual-test',
  });

  await fakeDb.collection('timer_logs').add({ timerId: timer.id, marker: true });

  const deletion = await RealTimer.delete(timer.id, { reason: 'test' });
  assert.equal(deletion.deleted, true);
  assert.ok(deletion.counts.logs >= 1, 'expected at least one log to be deleted');
  assert.ok(deletion.counts.replayEntries >= 1, 'expected replay entries to be removed');

  const metricsDoc = await fakeDb.collection('timer_deletion_metrics').get();
  assert.equal(metricsDoc.size, 1, 'expected deletion metric record');
});

test('cleanup removes processed replay entries older than threshold', async () => {
  global.fetch = async () => createResponse(500, {});

  const timer = await RealTimer.create({
    name: 'stale-timer',
    duration: 15,
    events: {
      on_expire: {
        webhook: 'https://example.com/bad',
      },
    },
  });

  await RealTimer.expire(timer.id);

  const processed = await RealTimer.processReplayQueue({ limit: 5 });
  assert.equal(processed.length, 1);

  // Mark the queue entry as old
  const queueSnapshot = await fakeDb.collection('timer_replay_queue').get();
  for (const doc of queueSnapshot.docs) {
    await doc.ref.update({ processedAtMs: 0 });
  }

  const cleanupResult = await RealTimer.cleanupReplayQueue({ olderThanMs: 1 });
  assert.ok(cleanupResult.purged >= 1, 'expected cleanup to purge entries');
});
