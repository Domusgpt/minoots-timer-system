const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('crypto');
const admin = require('firebase-admin');
const { instantiateTemplate } = require('./templates');

const DEFAULT_TIMER_DURATION = '5m';
const SUPPORTED_ACTION_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'skipped', 'cancelled', 'deferred']);

let dbOverride = null;

function getDb() {
  return dbOverride || admin.firestore();
}

function __setDbOverride(mockDb) {
  dbOverride = mockDb;
}

function __clearDbOverride() {
  dbOverride = null;
}

let nowOverride = null;

function now() {
  if (typeof nowOverride === 'function') {
    return nowOverride();
  }
  return admin.firestore.FieldValue.serverTimestamp();
}

function __setNowOverride(factory) {
  nowOverride = factory;
}

function __clearNowOverride() {
  nowOverride = null;
}

async function deleteByQuery(query, batchSize = 200) {
  const db = getDb();
  let totalDeleted = 0;

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
    totalDeleted += snapshot.size;
  }

  return totalDeleted;
}

function sanitizeSource(data, { includeSecret = false } = {}) {
  if (!data) {
    return null;
  }

  const base = {
    id: data.id,
    teamId: data.teamId,
    name: data.name,
    description: data.description || '',
    projectId: data.projectId || null,
    pipelineId: data.pipelineId || null,
    templateId: data.templateId || null,
    defaultTimer: data.defaultTimer || {},
    mapping: data.mapping || {},
    scheduling: data.scheduling || { mode: 'immediate', offsetMinutes: 0 },
    filters: data.filters || {},
    insightPaths: data.insightPaths || [],
    tags: data.tags || [],
    enabled: data.enabled !== false,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    createdBy: data.createdBy || null,
    updatedBy: data.updatedBy || null,
    lastEventAt: data.lastEventAt || null,
    lastEventId: data.lastEventId || null,
    lastEventStatus: data.lastEventStatus || null,
    webhookUrlPath: `/parserator/webhook?source=${data.id}`,
  };

  if (includeSecret) {
    base.webhookSecret = data.webhookSecret;
  } else if (data.webhookSecret) {
    base.secretPreview = data.webhookSecret.slice(-6);
  }

  return base;
}

function normalizeScheduling(config = {}) {
  return {
    mode: config.mode || 'immediate',
    offsetMinutes: typeof config.offsetMinutes === 'number' ? config.offsetMinutes : 0,
    basePath: config.basePath || null,
    datePath: config.datePath || null,
    delayMsPath: config.delayMsPath || null,
  };
}

function normalizeFilters(filters = {}) {
  const normalized = {};
  if (Array.isArray(filters.matchers)) {
    normalized.matchers = filters.matchers.map((matcher) => ({ ...matcher }));
  }
  if (Array.isArray(filters.requirePresent)) {
    normalized.requirePresent = filters.requirePresent.slice();
  }
  if (Array.isArray(filters.allowIf)) {
    normalized.allowIf = filters.allowIf.map((matcher) => ({ ...matcher }));
  }
  if (filters.dropIfMissing) {
    normalized.dropIfMissing = Array.isArray(filters.dropIfMissing)
      ? filters.dropIfMissing.slice()
      : [];
  }
  return normalized;
}

function generateSecret() {
  return randomBytes(24).toString('hex');
}

function splitPath(path = '') {
  return path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getValueAtPath(source, path) {
  if (!path) return undefined;
  const segments = splitPath(path);
  return segments.reduce((acc, key) => {
    if (acc === undefined || acc === null) {
      return undefined;
    }
    if (Array.isArray(acc)) {
      const index = Number(key);
      if (Number.isNaN(index)) {
        return undefined;
      }
      return acc[index];
    }
    return acc[key];
  }, source);
}

function setValueAtPath(target, path, value) {
  if (!path) return;
  const segments = splitPath(path);
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    if (cursor[key] === undefined) {
      const next = segments[i + 1];
      cursor[key] = Number.isInteger(Number(next)) ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
}

function renderTemplate(template, payload) {
  if (typeof template !== 'string') {
    return template;
  }
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, path) => {
    const value = getValueAtPath(payload, path.trim());
    return value !== undefined && value !== null ? String(value) : '';
  });
}

function applyTransform(value, transform) {
  if (transform === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  if (transform === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['true', '1', 'yes'].includes(value.toLowerCase());
    }
    return Boolean(value);
  }
  if (transform === 'string') {
    return value != null ? String(value) : undefined;
  }
  if (transform === 'date') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (transform === 'array') {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }
  if (transform === 'json') {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
      return undefined;
    }
  }
  return value;
}

function applyMapping(timer, mapping = {}, payload = {}) {
  Object.entries(mapping).forEach(([targetPath, descriptor]) => {
    if (!targetPath) return;
    let value;
    let transform;
    let fallback;

    if (descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)) {
      if (descriptor.template) {
        value = renderTemplate(descriptor.template, payload);
      } else if (descriptor.path) {
        value = getValueAtPath(payload, descriptor.path);
      } else if (descriptor.value !== undefined) {
        value = descriptor.value;
      }
      transform = descriptor.transform;
      fallback = descriptor.fallback;
    } else if (typeof descriptor === 'string') {
      if (descriptor.includes('{{')) {
        value = renderTemplate(descriptor, payload);
      } else {
        value = getValueAtPath(payload, descriptor);
      }
    } else {
      value = descriptor;
    }

    if ((value === undefined || value === null || value === '') && fallback !== undefined) {
      value = typeof fallback === 'string' && fallback.includes('{{')
        ? renderTemplate(fallback, payload)
        : fallback;
    }

    if (transform) {
      value = applyTransform(value, transform);
    }

    if (value !== undefined) {
      setValueAtPath(timer, targetPath, value);
    }
  });
}

function computeScheduledFor(scheduling = {}, payload) {
  const nowDate = new Date();
  const mode = scheduling.mode || 'immediate';

  if (mode === 'absolute') {
    const raw = scheduling.datePath ? getValueAtPath(payload, scheduling.datePath) : null;
    if (raw) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return nowDate;
  }

  if (mode === 'relative') {
    const baseRaw = scheduling.basePath ? getValueAtPath(payload, scheduling.basePath) : null;
    const base = baseRaw ? new Date(baseRaw) : nowDate;
    const offsetMinutes = Number.isFinite(Number(scheduling.offsetMinutes))
      ? Number(scheduling.offsetMinutes)
      : 0;
    return new Date(base.getTime() + offsetMinutes * 60000);
  }

  if (mode === 'delay') {
    const delayValue = scheduling.delayMsPath ? Number(getValueAtPath(payload, scheduling.delayMsPath)) : null;
    if (Number.isFinite(delayValue) && delayValue > 0) {
      return new Date(nowDate.getTime() + delayValue);
    }
    const fallback = Number.isFinite(Number(scheduling.offsetMinutes)) ? Number(scheduling.offsetMinutes) : 0;
    return new Date(nowDate.getTime() + fallback * 60000);
  }

  return nowDate;
}

function extractInsights(source, payload) {
  if (!Array.isArray(source.insightPaths) || source.insightPaths.length === 0) {
    return [];
  }
  return source.insightPaths
    .map((path) => ({ path, value: getValueAtPath(payload, path) }))
    .filter((entry) => entry.value !== undefined && entry.value !== null);
}

async function buildTimerConfig(source, payload) {
  let timerConfig = {};
  if (source.templateId) {
    try {
      timerConfig = await instantiateTemplate(source.teamId, source.templateId, source.defaultTimer || {});
    } catch (error) {
      timerConfig = { ...(source.defaultTimer || {}) };
    }
  } else {
    timerConfig = { ...(source.defaultTimer || {}) };
  }

  if (!timerConfig.duration) {
    timerConfig.duration = DEFAULT_TIMER_DURATION;
  }

  timerConfig.metadata = {
    ...(timerConfig.metadata || {}),
    parseratorSourceId: source.id,
    parseratorProjectId: source.projectId || null,
    parseratorPipelineId: source.pipelineId || null,
  };

  timerConfig.context = {
    ...(timerConfig.context || {}),
    parserator: {
      projectId: source.projectId || null,
      pipelineId: source.pipelineId || null,
      receivedAt: new Date().toISOString(),
    },
  };

  applyMapping(timerConfig, source.mapping || {}, payload);

  if (!timerConfig.name) {
    timerConfig.name = `Parserator ${source.name || source.id}`;
  }

  if (!timerConfig.agent_id && !timerConfig.agentId) {
    timerConfig.agent_id = 'parserator_bridge';
  }

  if (!timerConfig.team) {
    timerConfig.team = source.teamId;
  }

  return timerConfig;
}

function evaluateMatcher(matcher, payload) {
  if (!matcher || typeof matcher !== 'object') {
    return true;
  }
  const value = getValueAtPath(payload, matcher.path || matcher.field);
  if (matcher.equals !== undefined && value !== matcher.equals) {
    return false;
  }
  if (matcher.notEquals !== undefined && value === matcher.notEquals) {
    return false;
  }
  if (Array.isArray(matcher.in) && !matcher.in.includes(value)) {
    return false;
  }
  if (Array.isArray(matcher.notIn) && matcher.notIn.includes(value)) {
    return false;
  }
  if (matcher.contains && Array.isArray(value) && !value.includes(matcher.contains)) {
    return false;
  }
  if (matcher.exists === true && (value === undefined || value === null)) {
    return false;
  }
  if (matcher.exists === false && value !== undefined && value !== null) {
    return false;
  }
  return true;
}

function eventMatchesFilters(filters = {}, payload) {
  if (!filters || Object.keys(filters).length === 0) {
    return true;
  }

  if (Array.isArray(filters.requirePresent)) {
    for (const path of filters.requirePresent) {
      if (getValueAtPath(payload, path) === undefined) {
        return false;
      }
    }
  }

  if (filters.dropIfMissing) {
    for (const path of filters.dropIfMissing) {
      if (getValueAtPath(payload, path) === undefined) {
        return false;
      }
    }
  }

  if (Array.isArray(filters.matchers)) {
    for (const matcher of filters.matchers) {
      if (!evaluateMatcher(matcher, payload)) {
        return false;
      }
    }
  }

  if (Array.isArray(filters.allowIf) && filters.allowIf.length > 0) {
    return filters.allowIf.some((matcher) => evaluateMatcher(matcher, payload));
  }

  return true;
}

async function planParseratorActions(source, payload) {
  if (!source || source.enabled === false) {
    return [];
  }

  if (!eventMatchesFilters(source.filters || {}, payload)) {
    return [];
  }

  const timerConfig = await buildTimerConfig(source, payload);
  const scheduledFor = computeScheduledFor(source.scheduling || {}, payload);
  const insights = extractInsights(source, payload);

  return [
    {
      id: randomUUID(),
      type: 'timer',
      timer: timerConfig,
      scheduledFor,
      insights,
      reason: 'parserator_event',
    },
  ];
}

function normalizeSignature(signature) {
  if (!signature) {
    return '';
  }
  return signature.startsWith('sha256=') ? signature.slice(7) : signature;
}

function verifyParseratorSignature(rawBody, secret, signature) {
  if (!secret) {
    return false;
  }
  const normalized = normalizeSignature(signature);
  if (!normalized) {
    return false;
  }
  const payloadBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {}));
  const hmac = createHmac('sha256', secret).update(payloadBuffer).digest();
  const provided = Buffer.from(normalized, 'hex');
  if (hmac.length !== provided.length) {
    return false;
  }
  try {
    return timingSafeEqual(hmac, provided);
  } catch (error) {
    return false;
  }
}

function safePayload(payload, maxBytes = 900000) {
  if (payload === undefined) {
    return null;
  }
  try {
    const json = JSON.stringify(payload);
    const size = Buffer.byteLength(json, 'utf8');
    if (size <= maxBytes) {
      return payload;
    }
    return {
      truncated: true,
      preview: json.slice(0, Math.min(json.length, maxBytes / 2)),
      originalSize: size,
    };
  } catch (error) {
    return { truncated: true, preview: String(payload).slice(0, 512) };
  }
}

async function findSourceById(sourceId) {
  const db = getDb();
  const snapshot = await db.collectionGroup('parseratorSources').where('id', '==', sourceId).limit(1).get();
  if (snapshot.empty) {
    return null;
  }
  const doc = snapshot.docs[0];
  return { ref: doc.ref, data: doc.data() };
}

async function createParseratorSource(teamId, config = {}, actorId) {
  const db = getDb();
  const sourceId = config.id || randomUUID();
  const secret = config.webhookSecret || generateSecret();
  const timestamp = now();
  const ref = db.collection('teams').doc(teamId).collection('parseratorSources').doc(sourceId);

  const record = {
    id: sourceId,
    teamId,
    name: config.name || `Parserator Source ${sourceId.slice(0, 8)}`,
    description: config.description || '',
    projectId: config.projectId || null,
    pipelineId: config.pipelineId || null,
    templateId: config.templateId || null,
    defaultTimer: config.defaultTimer || {},
    mapping: config.mapping || {},
    scheduling: normalizeScheduling(config.scheduling),
    filters: normalizeFilters(config.filters || {}),
    insightPaths: Array.isArray(config.insightPaths) ? config.insightPaths.slice() : [],
    tags: Array.isArray(config.tags) ? config.tags.slice() : [],
    webhookSecret: secret,
    enabled: config.enabled !== false,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId || null,
    updatedBy: actorId || null,
  };

  await ref.set(record, { merge: true });
  return sanitizeSource(record, { includeSecret: true });
}

async function listParseratorSources(teamId) {
  const db = getDb();
  const snapshot = await db.collection('teams').doc(teamId).collection('parseratorSources').orderBy('name').get();
  return snapshot.docs.map((doc) => sanitizeSource(doc.data()));
}

async function getParseratorSource(teamId, sourceId) {
  const db = getDb();
  const doc = await db.collection('teams').doc(teamId).collection('parseratorSources').doc(sourceId).get();
  if (!doc.exists) {
    throw new Error('Parserator source not found');
  }
  return sanitizeSource(doc.data(), { includeSecret: true });
}

async function updateParseratorSource(teamId, sourceId, updates = {}, actorId) {
  const db = getDb();
  const ref = db.collection('teams').doc(teamId).collection('parseratorSources').doc(sourceId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Parserator source not found');
  }

  const payload = { updatedAt: now(), updatedBy: actorId || null };
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.projectId !== undefined) payload.projectId = updates.projectId;
  if (updates.pipelineId !== undefined) payload.pipelineId = updates.pipelineId;
  if (updates.templateId !== undefined) payload.templateId = updates.templateId;
  if (updates.defaultTimer !== undefined) payload.defaultTimer = updates.defaultTimer;
  if (updates.mapping !== undefined) payload.mapping = updates.mapping;
  if (updates.filters !== undefined) payload.filters = normalizeFilters(updates.filters);
  if (updates.insightPaths !== undefined) payload.insightPaths = Array.isArray(updates.insightPaths)
    ? updates.insightPaths.slice()
    : [];
  if (updates.tags !== undefined) payload.tags = Array.isArray(updates.tags) ? updates.tags.slice() : [];
  if (updates.enabled !== undefined) payload.enabled = Boolean(updates.enabled);
  if (updates.scheduling !== undefined) payload.scheduling = normalizeScheduling(updates.scheduling);

  await ref.set(payload, { merge: true });
  const next = await ref.get();
  return sanitizeSource(next.data());
}

async function rotateParseratorSourceSecret(teamId, sourceId, actorId) {
  const db = getDb();
  const ref = db.collection('teams').doc(teamId).collection('parseratorSources').doc(sourceId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Parserator source not found');
  }
  const secret = generateSecret();
  await ref.set({ webhookSecret: secret, updatedAt: now(), updatedBy: actorId || null }, { merge: true });
  const next = await ref.get();
  return sanitizeSource(next.data(), { includeSecret: true });
}

async function deleteParseratorSource(teamId, sourceId) {
  const db = getDb();
  const ref = db.collection('teams').doc(teamId).collection('parseratorSources').doc(sourceId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Parserator source not found');
  }

  await ref.delete();

  const eventsQuery = db
    .collection('teams')
    .doc(teamId)
    .collection('parseratorEvents')
    .where('sourceId', '==', sourceId);
  const actionsQuery = db
    .collection('teams')
    .doc(teamId)
    .collection('parseratorActions')
    .where('sourceId', '==', sourceId);

  const [eventsDeleted, actionsDeleted] = await Promise.all([
    deleteByQuery(eventsQuery),
    deleteByQuery(actionsQuery),
  ]);

  return { eventsDeleted, actionsDeleted };
}

async function replayParseratorAction(teamId, actionId, options = {}, actorId) {
  const db = getDb();
  const ref = db.collection('teams').doc(teamId).collection('parseratorActions').doc(actionId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Parserator action not found');
  }
  const original = doc.data();

  const scheduledDate = options.scheduledFor
    ? new Date(options.scheduledFor)
    : new Date();
  const scheduledFor = admin.firestore.Timestamp.fromDate(scheduledDate);
  const newId = options.id || randomUUID();

  const clone = {
    id: newId,
    sourceId: original.sourceId,
    teamId: original.teamId,
    eventId: original.eventId,
    status: 'pending',
    scheduledFor,
    timer: { ...(original.timer || {}) },
    insights: Array.isArray(original.insights) ? original.insights.slice() : [],
    reason: 'replay',
    attempts: 0,
    createdAt: now(),
    updatedAt: now(),
    createdBy: actorId || original.createdBy || null,
    replayOf: original.id,
    notes: options.notes || null,
  };

  await db.collection('teams').doc(teamId).collection('parseratorActions').doc(newId).set(clone);
  await ref.set({ lastReplayAt: now(), lastReplayBy: actorId || null }, { merge: true });

  return clone;
}

async function handleParseratorWebhook({ sourceId, rawBody, payload, signature, headers = {} }) {
  if (!sourceId) {
    throw new Error('Missing parserator source identifier');
  }
  const match = await findSourceById(sourceId);
  if (!match) {
    const error = new Error('Parserator source not found');
    error.statusCode = 404;
    throw error;
  }
  const { ref, data } = match;
  if (data.enabled === false) {
    const error = new Error('Parserator source is disabled');
    error.statusCode = 409;
    throw error;
  }
  if (!verifyParseratorSignature(rawBody, data.webhookSecret, signature)) {
    const error = new Error('Invalid parserator signature');
    error.statusCode = 401;
    throw error;
  }

  const teamId = data.teamId;
  const eventId = headers['x-parserator-event-id']
    || payload?.eventId
    || payload?.event_id
    || payload?.event?.id
    || payload?.id
    || randomUUID();

  const db = getDb();
  const eventsRef = db.collection('teams').doc(teamId).collection('parseratorEvents');
  const existing = await eventsRef.doc(eventId).get();
  if (existing.exists) {
    return { eventId, status: 'duplicate', actionCount: existing.data().actionCount || 0 };
  }

  let plannedActions = [];
  let status = 'queued';
  let skipReason = null;

  try {
    plannedActions = await planParseratorActions(data, payload || {});
    if (!plannedActions || plannedActions.length === 0) {
      status = 'skipped';
      skipReason = 'no_matching_actions';
    }
  } catch (error) {
    status = 'errored';
    skipReason = error.message;
    plannedActions = [];
  }

  const eventRecord = {
    id: eventId,
    sourceId: data.id,
    teamId,
    status,
    skipReason,
    actionCount: plannedActions.length,
    receivedAt: now(),
    payload: safePayload(payload),
    headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
  };

  await eventsRef.doc(eventId).set(eventRecord, { merge: true });

  const actionIds = [];
  if (status === 'queued') {
    const actionsRef = db.collection('teams').doc(teamId).collection('parseratorActions');
    for (const action of plannedActions) {
      const actionId = action.id || randomUUID();
      actionIds.push(actionId);
      await actionsRef.doc(actionId).set({
        id: actionId,
        sourceId: data.id,
        teamId,
        eventId,
        status: 'pending',
        scheduledFor: admin.firestore.Timestamp.fromDate(action.scheduledFor || new Date()),
        timer: action.timer,
        insights: action.insights || [],
        reason: action.reason || null,
        attempts: 0,
        createdAt: now(),
        updatedAt: now(),
        createdBy: data.createdBy || null,
      });
    }
  }

  await ref.set({
    lastEventAt: now(),
    lastEventId: eventId,
    lastEventStatus: status,
  }, { merge: true });

  return {
    eventId,
    status,
    actionCount: actionIds.length,
    actionIds,
  };
}

async function listParseratorEvents(teamId, options = {}) {
  const db = getDb();
  let query = db.collection('teams').doc(teamId).collection('parseratorEvents').orderBy('receivedAt', 'desc');
  if (options.status) {
    query = query.where('status', '==', options.status);
  }
  if (options.sourceId) {
    query = query.where('sourceId', '==', options.sourceId);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data());
}

async function listParseratorActions(teamId, options = {}) {
  const db = getDb();
  let query = db.collection('teams').doc(teamId).collection('parseratorActions').orderBy('scheduledFor', 'asc');
  if (options.status) {
    query = query.where('status', '==', options.status);
  }
  if (options.sourceId) {
    query = query.where('sourceId', '==', options.sourceId);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data());
}

async function updateParseratorActionStatus(teamId, actionId, updates = {}, actorId) {
  const db = getDb();
  const ref = db.collection('teams').doc(teamId).collection('parseratorActions').doc(actionId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Parserator action not found');
  }
  const data = doc.data();
  const payload = { updatedAt: now(), updatedBy: actorId || null };

  if (updates.status) {
    if (!SUPPORTED_ACTION_STATUSES.has(updates.status)) {
      throw new Error(`Unsupported action status: ${updates.status}`);
    }
    payload.status = updates.status;
  }

  if (updates.deferUntil) {
    payload.scheduledFor = admin.firestore.Timestamp.fromDate(new Date(updates.deferUntil));
    payload.status = 'deferred';
  }

  if (updates.result !== undefined) {
    payload.result = updates.result;
  }

  if (updates.notes !== undefined) {
    payload.notes = updates.notes;
  }

  if (updates.resetAttempts) {
    payload.attempts = 0;
  }

  await ref.set(payload, { merge: true });
  const next = await ref.get();
  return next.data();
}

async function previewParseratorMapping(teamId, sourceId, payload = {}) {
  const db = getDb();
  const doc = await db.collection('teams').doc(teamId).collection('parseratorSources').doc(sourceId).get();
  if (!doc.exists) {
    throw new Error('Parserator source not found');
  }
  const source = doc.data();
  const actions = await planParseratorActions(source, payload);
  return actions.map((action) => ({
    type: action.type,
    timer: action.timer,
    scheduledFor: action.scheduledFor,
    insights: action.insights || [],
  }));
}

module.exports = {
  createParseratorSource,
  listParseratorSources,
  getParseratorSource,
  updateParseratorSource,
  rotateParseratorSourceSecret,
  deleteParseratorSource,
  replayParseratorAction,
  handleParseratorWebhook,
  listParseratorEvents,
  listParseratorActions,
  updateParseratorActionStatus,
  previewParseratorMapping,
  planParseratorActions,
  verifyParseratorSignature,
  __setDbOverride,
  __clearDbOverride,
  __setNowOverride,
  __clearNowOverride,
};
