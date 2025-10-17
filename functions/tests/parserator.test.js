const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const admin = require('firebase-admin');

let currentDb = null;

class FakeTimestamp {
  constructor(date) {
    this.date = date instanceof Date ? date : new Date(date);
  }

  static fromDate(date) {
    return new FakeTimestamp(date);
  }

  static now() {
    return new FakeTimestamp(new Date('2025-01-01T00:00:00.000Z'));
  }

  toDate() {
    return new Date(this.date.getTime());
  }

  valueOf() {
    return this.date.getTime();
  }
}

admin.initializeApp = () => {};
admin.firestore = () => currentDb;
admin.firestore.FieldValue = {
  serverTimestamp: () => new Date('2025-01-01T00:00:00.000Z'),
};
admin.firestore.Timestamp = FakeTimestamp;

const parserator = require('../utils/parserator');
const { processParseratorActionsHandler } = require('../index.js').__test;

function clone(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof FakeTimestamp) {
    return new FakeTimestamp(value.toDate());
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  return structuredClone(value);
}

function mergeDeep(target = {}, source = {}) {
  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeDeep(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

class MockDocRef {
  constructor(store, pathSegments) {
    this.store = store;
    this.pathSegments = pathSegments;
    this.id = pathSegments[pathSegments.length - 1];
  }

  path() {
    return this.pathSegments.join('/');
  }

  async get() {
    const data = this.store.get(this.path());
    return new MockDocSnapshot(this, data === undefined ? undefined : clone(data));
  }

  async set(data, options = {}) {
    const key = this.path();
    if (options.merge && this.store.has(key)) {
      const existing = this.store.get(key);
      this.store.set(key, mergeDeep(existing, clone(data)));
    } else {
      this.store.set(key, clone(data));
    }
  }

  async delete() {
    this.store.delete(this.path());
  }

  collection(name) {
    return new MockCollectionRef(this.store, [...this.pathSegments, name]);
  }
}

class MockDocSnapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.id = ref.id;
    this._data = data === undefined ? undefined : clone(data);
  }

  get exists() {
    return this._data !== undefined;
  }

  data() {
    return this._data === undefined ? undefined : clone(this._data);
  }
}

function matchesPath(segments, baseSegments) {
  if (segments.length < baseSegments.length + 1) {
    return false;
  }
  for (let i = 0; i < baseSegments.length; i += 1) {
    if (segments[i] !== baseSegments[i]) {
      return false;
    }
  }
  return true;
}

function matchesCollectionGroup(segments, groupName) {
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] === groupName) {
      return true;
    }
  }
  return false;
}

function comparable(value) {
  if (value && typeof value.valueOf === 'function') {
    return value.valueOf();
  }
  if (value && typeof value === 'object' && typeof value._seconds === 'number') {
    const base = value._seconds * 1000;
    const nanos = typeof value._nanoseconds === 'number' ? value._nanoseconds / 1e6 : 0;
    return base + nanos;
  }
  return value;
}

class MockBatch {
  constructor(store) {
    this.store = store;
    this.ops = [];
  }

  delete(ref) {
    this.ops.push(() => {
      this.store.delete(ref.path());
    });
  }

  async commit() {
    this.ops.forEach((op) => op());
    this.ops = [];
  }
}

class MockQuery {
  constructor(store, pathSegments, filters = [], orderBys = [], limitValue = null, groupName = null) {
    this.store = store;
    this.pathSegments = pathSegments;
    this.filters = filters;
    this.orderBys = orderBys;
    this.limitValue = limitValue;
    this.groupName = groupName;
  }

  where(field, op, value) {
    return new MockQuery(this.store, this.pathSegments, [...this.filters, { field, op, value }], this.orderBys, this.limitValue, this.groupName);
  }

  orderBy(field, direction = 'asc') {
    return new MockQuery(this.store, this.pathSegments, this.filters, [...this.orderBys, { field, direction }], this.limitValue, this.groupName);
  }

  limit(n) {
    return new MockQuery(this.store, this.pathSegments, this.filters, this.orderBys, n, this.groupName);
  }

  async get() {
    const docs = [];
    for (const [key, value] of this.store.entries()) {
      const segments = key.split('/');
      if (this.groupName) {
        if (!matchesCollectionGroup(segments, this.groupName)) {
          continue;
        }
      } else if (!matchesPath(segments, this.pathSegments)) {
        continue;
      }
      const data = clone(value);
      if (!this._matchesFilters(data)) {
        continue;
      }
      const docRef = new MockDocRef(this.store, segments);
      docs.push(new MockDocSnapshot(docRef, data));
    }

    if (this.orderBys.length > 0) {
      docs.sort((a, b) => {
        for (const order of this.orderBys) {
          const aValue = comparable(a.data()?.[order.field]);
          const bValue = comparable(b.data()?.[order.field]);
          if (aValue < bValue) {
            return order.direction.toLowerCase() === 'desc' ? 1 : -1;
          }
          if (aValue > bValue) {
            return order.direction.toLowerCase() === 'desc' ? -1 : 1;
          }
        }
        return 0;
      });
    }

    const limited = this.limitValue != null ? docs.slice(0, this.limitValue) : docs;
    return {
      docs: limited,
      size: limited.length,
      empty: limited.length === 0,
      forEach(cb) {
        limited.forEach(cb);
      },
    };
  }

  _matchesFilters(data) {
    for (const filter of this.filters) {
      const value = data?.[filter.field];
      const comparator = comparable(filter.value);
      const subject = comparable(value);
      if (filter.op === '==') {
        if (subject !== comparator) {
          return false;
        }
      } else if (filter.op === '<=') {
        if (!(subject <= comparator)) {
          return false;
        }
      } else {
        throw new Error(`Unsupported operator ${filter.op}`);
      }
    }
    return true;
  }
}

class MockCollectionRef extends MockQuery {
  constructor(store, pathSegments) {
    super(store, pathSegments);
    this.store = store;
    this.pathSegments = pathSegments;
  }

  doc(id) {
    return new MockDocRef(this.store, [...this.pathSegments, id]);
  }
}

function createMockDb(initialData = {}) {
  const store = new Map();
  for (const [path, value] of Object.entries(initialData)) {
    store.set(path, clone(value));
  }

  const db = {
    __store: store,
    collection(name) {
      return new MockCollectionRef(store, [name]);
    },
    collectionGroup(name) {
      const buildQuery = (state = { status: undefined, before: undefined, limit: null }) => ({
        where(field, op, value) {
          const next = { ...state };
          if (field === 'status' && op === '==') {
            next.status = value;
          } else if (field === 'scheduledFor' && op === '<=') {
            next.before = value;
          } else {
            next.extra = [...(next.extra || []), { field, op, value }];
          }
          return buildQuery(next);
        },
        limit(n) {
          return buildQuery({ ...state, limit: n });
        },
        async get() {
          const docs = [];
          for (const [key, value] of store.entries()) {
            const segments = key.split('/');
            const index = segments.indexOf(name);
            if (index === -1 || index % 2 !== 0) {
              continue;
            }
            const data = clone(value);
            if (state.status !== undefined) {
              if (comparable(data?.status) !== comparable(state.status)) {
                continue;
              }
            }
            if (state.before !== undefined) {
              if (!(comparable(data?.scheduledFor) <= comparable(state.before))) {
                continue;
              }
            }
            if (state.extra) {
              for (const filter of state.extra) {
                const docValue = data?.[filter.field];
                const subject = comparable(docValue);
                const comparator = comparable(filter.value);
                if (filter.op === '==') {
                  if (subject !== comparator) {
                    continue;
                  }
                } else if (filter.op === '<=') {
                  if (!(subject <= comparator)) {
                    continue;
                  }
                }
              }
            }
            const docRef = new MockDocRef(store, segments);
            docs.push(new MockDocSnapshot(docRef, data));
            if (state.limit != null && docs.length >= state.limit) {
              break;
            }
          }
          return {
            docs,
            size: docs.length,
            empty: docs.length === 0,
            forEach(cb) {
              docs.forEach(cb);
            },
          };
        },
      });
      return buildQuery();
    },
    batch() {
      return new MockBatch(store);
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        update(ref, data) {
          return ref.set(data, { merge: true });
        },
        set(ref, data, options) {
          return ref.set(data, options);
        },
      };
      return fn(tx);
    },
  };

  return db;
}

beforeEach(() => {
  parserator.__setNowOverride(() => new Date('2025-01-01T00:00:00.000Z'));
});

afterEach(() => {
  parserator.__clearDbOverride();
  parserator.__clearNowOverride();
  currentDb = null;
});

test('handleParseratorWebhook rejects invalid signatures', async () => {
  const db = createMockDb({
    'teams/team-1/parseratorSources/src-1': {
      id: 'src-1',
      teamId: 'team-1',
      name: 'Demo Source',
      webhookSecret: 'topsecret',
      enabled: true,
      mapping: {},
      filters: {},
      defaultTimer: { duration: '5m' },
    },
  });
  currentDb = db;
  parserator.__setDbOverride(db);

  const payload = { id: 'evt-1', message: 'hello' };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', 'othersecret').update(rawBody).digest('hex')}`;

  await assert.rejects(
    () => parserator.handleParseratorWebhook({
      sourceId: 'src-1',
      rawBody,
      payload,
      signature,
      headers: {},
    }),
    (error) => error.statusCode === 401,
  );
});

test('handleParseratorWebhook stores skipped events without enqueuing actions', async () => {
  const db = createMockDb({
    'teams/team-1/parseratorSources/src-1': {
      id: 'src-1',
      teamId: 'team-1',
      name: 'Demo Source',
      webhookSecret: 'topsecret',
      enabled: true,
      mapping: {},
      filters: { matchers: [{ path: 'type', equals: 'allowed' }] },
      defaultTimer: { duration: '5m' },
    },
  });
  currentDb = db;
  parserator.__setDbOverride(db);

  const payload = { id: 'evt-2', type: 'other' };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', 'topsecret').update(rawBody).digest('hex')}`;

  const result = await parserator.handleParseratorWebhook({
    sourceId: 'src-1',
    rawBody,
    payload,
    signature,
    headers: {},
  });

  assert.equal(result.status, 'skipped');
  const eventEntry = Array.from(db.__store.entries()).find(([path]) => path.startsWith('teams/team-1/parseratorEvents/'));
  assert.ok(eventEntry, 'event should be recorded');
  const actionEntry = Array.from(db.__store.entries()).find(([path]) => path.includes('parseratorActions'));
  assert.equal(actionEntry, undefined);
});

test('handleParseratorWebhook queues actions when filters match', async () => {
  const db = createMockDb({
    'teams/team-1/parseratorSources/src-1': {
      id: 'src-1',
      teamId: 'team-1',
      name: 'Demo Source',
      webhookSecret: 'topsecret',
      enabled: true,
      mapping: {},
      filters: { matchers: [{ path: 'type', equals: 'allowed' }] },
      defaultTimer: { duration: '5m' },
    },
  });
  currentDb = db;
  parserator.__setDbOverride(db);

  const payload = { id: 'evt-3', type: 'allowed' };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', 'topsecret').update(rawBody).digest('hex')}`;

  const result = await parserator.handleParseratorWebhook({
    sourceId: 'src-1',
    rawBody,
    payload,
    signature,
    headers: {},
  });

  assert.equal(result.status, 'queued');
  assert.ok(result.actionIds.length > 0);
  const actions = Array.from(db.__store.entries()).filter(([path]) => path.startsWith('teams/team-1/parseratorActions/'));
  assert.equal(actions.length, result.actionIds.length);
});

test('deleteParseratorSource cascades events and actions', async () => {
  const db = createMockDb({
    'teams/team-1/parseratorSources/src-1': { id: 'src-1', teamId: 'team-1', webhookSecret: 'secret' },
    'teams/team-1/parseratorEvents/evt-a': { id: 'evt-a', sourceId: 'src-1' },
    'teams/team-1/parseratorEvents/evt-b': { id: 'evt-b', sourceId: 'src-1' },
    'teams/team-1/parseratorActions/act-a': { id: 'act-a', sourceId: 'src-1' },
    'teams/team-1/parseratorActions/act-b': { id: 'act-b', sourceId: 'src-1' },
  });
  currentDb = db;
  parserator.__setDbOverride(db);

  const result = await parserator.deleteParseratorSource('team-1', 'src-1');

  assert.deepEqual(result, { eventsDeleted: 2, actionsDeleted: 2 });
  const remaining = Array.from(db.__store.keys()).filter((path) => path.includes('parserator'));
  assert.equal(remaining.length, 0);
});

test('replayParseratorAction duplicates action with pending status', async () => {
  const db = createMockDb({
    'teams/team-1/parseratorActions/act-1': {
      id: 'act-1',
      sourceId: 'src-1',
      teamId: 'team-1',
      eventId: 'evt-1',
      status: 'failed',
      timer: { duration: '5m', metadata: {} },
      insights: [],
      attempts: 2,
    },
  });
  currentDb = db;
  parserator.__setDbOverride(db);

  const clone = await parserator.replayParseratorAction(
    'team-1',
    'act-1',
    { id: 'act-replay', scheduledFor: '2025-01-02T00:00:00.000Z', notes: 'retry' },
    'tester-1',
  );

  assert.equal(clone.id, 'act-replay');
  assert.equal(clone.status, 'pending');
  assert.equal(clone.notes, 'retry');
  const keys = Array.from(db.__store.keys());
  assert.ok(keys.includes('teams/team-1/parseratorActions/act-replay'));
});

test('processParseratorActionsHandler completes pending actions', async () => {
  const actionDoc = {
    id: 'act-1',
    sourceId: 'src-1',
    teamId: 'team-1',
    eventId: 'evt-1',
    status: 'pending',
    attempts: 0,
    timer: { metadata: {}, duration: '5m' },
  };

  const docRef = {
    id: actionDoc.id,
    async set(data, options) {
      if (options?.merge) {
        Object.assign(actionDoc, data);
      } else {
        Object.assign(actionDoc, data);
      }
    },
  };

  const snapshotDoc = {
    ref: docRef,
    id: actionDoc.id,
    data() {
      return { ...actionDoc, scheduledFor: admin.firestore.Timestamp.now() };
    },
  };

  const db = {
    collectionGroup() {
      return {
        where() {
          return this;
        },
        limit() {
          return this;
        },
        async get() {
          return {
            empty: false,
            size: 1,
            docs: [snapshotDoc],
            forEach(cb) {
              cb(snapshotDoc);
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      return fn({
        async get() {
          return { exists: true, data: () => ({ ...snapshotDoc.data() }) };
        },
        update(ref, data) {
          Object.assign(actionDoc, data);
        },
      });
    },
  };

  const calls = [];
  const timer = {
    async create(config) {
      calls.push(config);
      return { id: 'timer-1' };
    },
  };

  const result = await processParseratorActionsHandler({ dbInstance: db, timer });
  assert.equal(result.processed, 1);
  assert.equal(actionDoc.status, 'completed');
  assert.equal(actionDoc.result.timerId, 'timer-1');
  assert.equal(calls.length, 1);
});

test('processParseratorActionsHandler marks failures when timer creation throws', async () => {
  const actionDoc = {
    id: 'act-1',
    sourceId: 'src-1',
    teamId: 'team-1',
    eventId: 'evt-1',
    status: 'pending',
    attempts: 0,
    timer: { metadata: {}, duration: '5m' },
  };

  const docRef = {
    id: actionDoc.id,
    async set(data, options) {
      if (options?.merge) {
        Object.assign(actionDoc, data);
      } else {
        Object.assign(actionDoc, data);
      }
    },
  };

  const snapshotDoc = {
    ref: docRef,
    id: actionDoc.id,
    data() {
      return { ...actionDoc, scheduledFor: admin.firestore.Timestamp.now() };
    },
  };

  const db = {
    collectionGroup() {
      return {
        where() {
          return this;
        },
        limit() {
          return this;
        },
        async get() {
          return {
            empty: false,
            size: 1,
            docs: [snapshotDoc],
            forEach(cb) {
              cb(snapshotDoc);
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      return fn({
        async get() {
          return { exists: true, data: () => ({ ...snapshotDoc.data() }) };
        },
        update(ref, data) {
          Object.assign(actionDoc, data);
        },
      });
    },
  };

  const timer = {
    async create() {
      throw new Error('boom');
    },
  };

  const result = await processParseratorActionsHandler({ dbInstance: db, timer });
  assert.equal(result.processed, 0);
  assert.equal(actionDoc.status, 'failed');
  assert.match(actionDoc.lastError, /boom/);
});
