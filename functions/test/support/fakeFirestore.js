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

function configureAdmin(admin, firestoreInstance) {
  const firestoreFn = () => firestoreInstance;
  firestoreFn.FieldValue = {
    serverTimestamp: () => Date.now(),
    delete: () => ({ __delete: true }),
  };
  firestoreFn.Timestamp = {
    fromDate: (date) => (date instanceof Date ? date : new Date(date)),
    fromMillis: (ms) => new Date(ms),
  };
  admin.firestore = firestoreFn;
  return admin;
}

module.exports = {
  FakeFirestore,
  FakeCollectionReference,
  FakeDocumentReference,
  FakeDocumentSnapshot,
  FakeQuerySnapshot,
  createFakeFirestore: () => new FakeFirestore(),
  configureAdmin,
  cloneData,
};
