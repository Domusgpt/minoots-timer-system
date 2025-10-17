const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

function cloneData(data) {
  if (data === undefined) {
    return undefined;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(data);
  }
  return JSON.parse(JSON.stringify(data));
}

function mergeDocuments(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && value.__delete) {
      delete result[key];
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[key] = mergeDocuments(result[key] || {}, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

class FakeQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
}

class FakeDocumentSnapshot {
  constructor(id, data, ref) {
    this.id = id;
    this._data = data;
    this.exists = data !== undefined;
    this.ref = ref;
  }

  data() {
    return cloneData(this._data);
  }
}

class FakeDocumentReference {
  constructor(firestore, collectionPath, id) {
    this._firestore = firestore;
    this._collectionPath = collectionPath;
    this.id = id;
  }

  _store() {
    return this._firestore._ensure(this._collectionPath);
  }

  async set(data, options = {}) {
    const store = this._store();
    if (options.merge) {
      const existing = store.get(this.id) || {};
      store.set(this.id, mergeDocuments(existing, data));
    } else {
      store.set(this.id, cloneData(data));
    }
    return this;
  }

  async get() {
    const store = this._store();
    const data = store.get(this.id);
    return new FakeDocumentSnapshot(this.id, data, this);
  }

  async delete() {
    this._store().delete(this.id);
  }

  async update(updates) {
    const store = this._store();
    const existing = store.get(this.id) || {};
    store.set(this.id, mergeDocuments(existing, updates));
  }

  collection(name) {
    const path = `${this._collectionPath}/${this.id}/${name}`;
    return new FakeCollectionReference(this._firestore, path);
  }
}

class FakeQuery {
  constructor(firestore, collectionPath, filters = [], order = null, limitValue = null) {
    this._firestore = firestore;
    this._collectionPath = collectionPath;
    this._filters = filters;
    this._order = order;
    this._limit = limitValue;
  }

  where(field, op, value) {
    return new FakeQuery(this._firestore, this._collectionPath, [...this._filters, { field, op, value }], this._order, this._limit);
  }

  orderBy(field, direction = 'asc') {
    return new FakeQuery(this._firestore, this._collectionPath, [...this._filters], { field, direction: direction.toLowerCase() }, this._limit);
  }

  limit(count) {
    return new FakeQuery(this._firestore, this._collectionPath, [...this._filters], this._order, count);
  }

  _matches(doc) {
    for (const filter of this._filters) {
      const value = doc[filter.field];
      switch (filter.op) {
        case '==':
          if (value !== filter.value) return false;
          break;
        case 'array-contains':
          if (!Array.isArray(value) || !value.includes(filter.value)) return false;
          break;
        case '<':
          if (!(value < filter.value)) return false;
          break;
        case '<=':
          if (!(value <= filter.value)) return false;
          break;
        case '>':
          if (!(value > filter.value)) return false;
          break;
        case '>=':
          if (!(value >= filter.value)) return false;
          break;
        case 'in':
          if (!Array.isArray(filter.value) || !filter.value.includes(value)) return false;
          break;
        default:
          throw new Error(`Unsupported operator: ${filter.op}`);
      }
    }
    return true;
  }

  async get() {
    const store = this._firestore._ensure(this._collectionPath);
    let docs = Array.from(store.entries()).map(([id, data]) => ({ id, data }));
    docs = docs.filter(({ data }) => this._matches(data));

    if (this._order) {
      const { field, direction } = this._order;
      docs.sort((a, b) => {
        const av = a.data[field];
        const bv = b.data[field];
        if (av === bv) return 0;
        if (direction === 'desc') {
          return av > bv ? -1 : 1;
        }
        return av > bv ? 1 : -1;
      });
    }

    if (typeof this._limit === 'number') {
      docs = docs.slice(0, this._limit);
    }

    const snapshots = docs.map(({ id, data }) => new FakeDocumentSnapshot(id, data, new FakeDocumentReference(this._firestore, this._collectionPath, id)));
    return new FakeQuerySnapshot(snapshots);
  }
}

class FakeCollectionReference extends FakeQuery {
  constructor(firestore, collectionPath) {
    super(firestore, collectionPath);
  }

  doc(id = randomUUID()) {
    return new FakeDocumentReference(this._firestore, this._collectionPath, id);
  }

  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

class FakeWriteBatch {
  constructor(firestore) {
    this._firestore = firestore;
    this._operations = [];
  }

  set(ref, data, options) {
    this._operations.push(() => ref.set(data, options));
    return this;
  }

  delete(ref) {
    this._operations.push(() => ref.delete());
    return this;
  }

  update(ref, data) {
    this._operations.push(() => ref.update(data));
    return this;
  }

  async commit() {
    for (const operation of this._operations) {
      await operation();
    }
  }
}

class FakeFirestore {
  constructor() {
    this._collections = new Map();
  }

  _ensure(path) {
    if (!this._collections.has(path)) {
      this._collections.set(path, new Map());
    }
    return this._collections.get(path);
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  batch() {
    return new FakeWriteBatch(this);
  }

  reset() {
    this._collections.clear();
  }
}

const { __testHooks } = require('../index.js');
const { RealTimer, overrideDb, admin } = __testHooks;

const fakeDb = new FakeFirestore();
overrideDb(fakeDb);

admin.firestore = admin.firestore || {};
admin.firestore.FieldValue = {
  serverTimestamp: () => Date.now(),
  delete: () => ({ __delete: true }),
};
admin.firestore.Timestamp = {
  fromDate: (date) => date,
};

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
