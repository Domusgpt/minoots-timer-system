const admin = require('firebase-admin');
const crypto = require('node:crypto');
const { v4: uuidv4 } = require('uuid');

const WEBHOOK_COLLECTION = 'webhooks';
const WEBHOOK_QUEUE_COLLECTION = 'webhook_queue';
const WEBHOOK_LOG_COLLECTION = 'webhook_logs';
const WEBHOOK_EVENT_COLLECTION = 'webhook_events';

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 5;
const BACKOFF_SCHEDULE = [0, 2000, 5000, 15000, 60000, 300000];

let dbOverride = null;

function setDbOverride(instance) {
  dbOverride = instance;
}

function getDb() {
  if (dbOverride) {
    return dbOverride;
  }
  return admin.firestore();
}

function nowMs() {
  return Date.now();
}

function computeSignature(secret, timestamp, payload) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}

function verifySignature(secret, signatureHeader, payload) {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return false;
  }
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((chunk) => {
      const [key, value] = chunk.split('=');
      return [key.trim(), value];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    return false;
  }
  const expected = computeSignature(secret, timestamp, payload);
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (error) {
    return false;
  }
}

function sanitizeWebhook(doc) {
  const { secret, ...rest } = doc;
  return rest;
}

async function registerWebhook(teamId, config = {}) {
  const db = getDb();
  const secret = config.secret || crypto.randomBytes(32).toString('hex');
  const now = nowMs();
  const docRef = db.collection(WEBHOOK_COLLECTION).doc();
  const record = {
    teamId,
    url: config.url,
    description: config.description || null,
    events: Array.isArray(config.events) ? config.events : ['timer.created', 'timer.updated', 'timer.expired'],
    headers: config.headers || {},
    secret,
    active: config.active !== false,
    timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
    createdAt: now,
    updatedAt: now,
    lastDeliveredAt: null,
    lastStatus: null,
    templateKey: config.templateKey || null,
  };

  if (!record.url) {
    throw new Error('Webhook url is required');
  }

  await docRef.set(record);
  return { webhook: { id: docRef.id, ...sanitizeWebhook(record) }, secret };
}

async function listWebhooks(teamId) {
  const db = getDb();
  const snapshot = await db.collection(WEBHOOK_COLLECTION).where('teamId', '==', teamId).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...sanitizeWebhook(doc.data()) }));
}

async function getWebhook(teamId, webhookId, { includeSecret = false } = {}) {
  const db = getDb();
  const doc = await db.collection(WEBHOOK_COLLECTION).doc(webhookId).get();
  if (!doc.exists) {
    return null;
  }
  const data = doc.data();
  if (data.teamId !== teamId) {
    return null;
  }
  if (includeSecret) {
    return { id: doc.id, ...data };
  }
  return { id: doc.id, ...sanitizeWebhook(data) };
}

async function updateWebhook(teamId, webhookId, updates = {}) {
  const db = getDb();
  const ref = db.collection(WEBHOOK_COLLECTION).doc(webhookId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Webhook not found');
  }
  const data = doc.data();
  if (data.teamId !== teamId) {
    throw new Error('Webhook not found');
  }

  const now = nowMs();
  const payload = { updatedAt: now };
  if (updates.url) {
    payload.url = updates.url;
  }
  if (updates.description !== undefined) {
    payload.description = updates.description;
  }
  if (updates.events) {
    payload.events = Array.isArray(updates.events) ? updates.events : data.events;
  }
  if (updates.headers) {
    payload.headers = updates.headers;
  }
  if (updates.active !== undefined) {
    payload.active = !!updates.active;
  }
  if (updates.timeoutMs) {
    payload.timeoutMs = updates.timeoutMs;
  }
  if (updates.templateKey !== undefined) {
    payload.templateKey = updates.templateKey;
  }
  let rotatedSecret = null;
  if (updates.rotateSecret) {
    rotatedSecret = crypto.randomBytes(32).toString('hex');
    payload.secret = rotatedSecret;
  }

  await ref.update(payload);
  const updated = await ref.get();
  const sanitized = { id: updated.id, ...sanitizeWebhook(updated.data()) };
  return rotatedSecret ? { webhook: sanitized, secret: rotatedSecret } : { webhook: sanitized };
}

async function deleteWebhook(teamId, webhookId) {
  const db = getDb();
  const ref = db.collection(WEBHOOK_COLLECTION).doc(webhookId);
  const doc = await ref.get();
  if (!doc.exists) {
    return false;
  }
  if (doc.data().teamId !== teamId) {
    return false;
  }
  await ref.delete();
  return true;
}

function buildHeadersForDelivery(webhook, payloadString, timestamp, eventId) {
  return {
    'content-type': 'application/json',
    'user-agent': 'Minoots-Webhooks/1.0',
    'x-minoots-event-id': eventId,
    'x-minoots-signature': `t=${timestamp},v1=${computeSignature(webhook.secret, timestamp, payloadString)}`,
    ...webhook.headers,
  };
}

async function recordLog(entry) {
  const db = getDb();
  const doc = db.collection(WEBHOOK_LOG_COLLECTION).doc();
  await doc.set({ ...entry, createdAt: nowMs() });
  return doc.id;
}

async function queueWebhookDelivery(delivery) {
  const db = getDb();
  const doc = db.collection(WEBHOOK_QUEUE_COLLECTION).doc();
  const record = {
    id: doc.id,
    teamId: delivery.teamId,
    webhookId: delivery.webhookId,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    payload: delivery.payload,
    attempt: delivery.attempt || 0,
    scheduledFor: delivery.scheduledFor || nowMs(),
    createdAt: nowMs(),
  };
  await doc.set(record);
  return record;
}

async function publishEvent(teamId, eventType, payload = {}, options = {}) {
  const db = getDb();
  const now = nowMs();
  const eventId = options.eventId || uuidv4();
  await db.collection(WEBHOOK_EVENT_COLLECTION).doc(eventId).set({
    teamId,
    eventType,
    payload,
    createdAt: now,
  });

  const webhooks = await listWebhooks(teamId);
  const deliveries = await Promise.all(
    webhooks
      .filter((hook) => hook.active !== false && (!hook.events || hook.events.includes(eventType)))
      .map((hook) =>
        queueWebhookDelivery({
          teamId,
          webhookId: hook.id,
          eventId,
          eventType,
          payload,
        })
      )
  );
  return { eventId, deliveries };
}

async function deliverQueueEntry(entry) {
  const webhook = await getWebhook(entry.teamId, entry.webhookId, { includeSecret: true });
  if (!webhook || webhook.active === false) {
    await recordLog({
      teamId: entry.teamId,
      webhookId: entry.webhookId,
      eventId: entry.eventId,
      eventType: entry.eventType,
      attempt: entry.attempt,
      status: webhook ? 'disabled' : 'missing',
      responseCode: null,
      responseBody: null,
      error: webhook ? null : 'webhook missing',
    });
    return { delivered: false, reason: webhook ? 'disabled' : 'missing' };
  }

  const payloadString = JSON.stringify({
    id: entry.eventId,
    event: entry.eventType,
    created_at: new Date(entry.createdAt || nowMs()).toISOString(),
    payload: entry.payload,
  });
  const timestamp = Math.floor(nowMs() / 1000);
  const headers = buildHeadersForDelivery(webhook, payloadString, timestamp, entry.eventId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webhook.timeoutMs || DEFAULT_TIMEOUT_MS);
  let response;
  let responseBody = null;
  let status = 'delivered';
  let errorMessage = null;
  const started = nowMs();

  try {
    response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: controller.signal,
    });
    if (!response.ok) {
      status = 'error';
    }
    try {
      responseBody = await response.text();
    } catch (error) {
      responseBody = null;
    }
  } catch (error) {
    status = 'error';
    errorMessage = error.message;
  } finally {
    clearTimeout(timeout);
  }

  const logEntry = {
    teamId: entry.teamId,
    webhookId: entry.webhookId,
    eventId: entry.eventId,
    eventType: entry.eventType,
    attempt: entry.attempt,
    durationMs: nowMs() - started,
    status,
    responseCode: response ? response.status : null,
    responseBody,
    error: errorMessage,
  };
  await recordLog(logEntry);

  if (status === 'delivered') {
    const db = getDb();
    await db.collection(WEBHOOK_COLLECTION).doc(webhook.id).update({
      lastDeliveredAt: nowMs(),
      lastStatus: 'delivered',
    });
    return { delivered: true };
  }

  const nextAttempt = entry.attempt + 1;
  if (nextAttempt > MAX_ATTEMPTS) {
    const db = getDb();
    await db.collection(WEBHOOK_COLLECTION).doc(webhook.id).update({
      lastDeliveredAt: nowMs(),
      lastStatus: 'failed',
    });
    return { delivered: false, reason: 'max_attempts' };
  }

  const backoff = BACKOFF_SCHEDULE[Math.min(nextAttempt, BACKOFF_SCHEDULE.length - 1)];
  await queueWebhookDelivery({
    teamId: entry.teamId,
    webhookId: entry.webhookId,
    eventId: entry.eventId,
    eventType: entry.eventType,
    payload: entry.payload,
    attempt: nextAttempt,
    scheduledFor: nowMs() + backoff,
  });
  return { delivered: false, reason: 'retry_scheduled' };
}

async function dispatchQueuedDeliveries({ limit = 25 } = {}) {
  const db = getDb();
  const now = nowMs();
  const snapshot = await db
    .collection(WEBHOOK_QUEUE_COLLECTION)
    .where('scheduledFor', '<=', now)
    .orderBy('scheduledFor', 'asc')
    .limit(limit)
    .get();

  const results = {
    processed: 0,
    delivered: 0,
    retried: 0,
    dropped: 0,
  };

  for (const doc of snapshot.docs) {
    const entry = { id: doc.id, ...doc.data() };
    await doc.ref.delete();
    results.processed += 1;
    const result = await deliverQueueEntry(entry);
    if (result.delivered) {
      results.delivered += 1;
    } else if (result.reason === 'retry_scheduled') {
      results.retried += 1;
    } else {
      results.dropped += 1;
    }
  }

  return results;
}

async function triggerTestDelivery(teamId, webhookId) {
  const webhook = await getWebhook(teamId, webhookId, { includeSecret: true });
  if (!webhook) {
    throw new Error('Webhook not found');
  }
  return publishEvent(teamId, 'webhook.test', {
    webhook: {
      id: webhook.id,
      url: webhook.url,
      description: webhook.description,
    },
    timestamp: new Date().toISOString(),
    note: 'Minoots webhook connectivity test',
  });
}

async function getWebhookLogs(teamId, webhookId, { limit = 25, cursor } = {}) {
  const db = getDb();
  let query = db
    .collection(WEBHOOK_LOG_COLLECTION)
    .where('teamId', '==', teamId)
    .where('webhookId', '==', webhookId)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (cursor) {
    const cursorDoc = await db.collection(WEBHOOK_LOG_COLLECTION).doc(cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const entries = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const nextCursor = entries.length === limit ? entries[entries.length - 1].id : null;
  return { entries, nextCursor };
}

const WEBHOOK_TEMPLATES = [
  {
    key: 'slack-basic',
    name: 'Slack – Timer Notifications',
    description: 'Posts timer lifecycle events into a Slack channel using an incoming webhook URL.',
    samplePayload: {
      text: 'Timer {{timer.name}} just {{event}}. Duration: {{timer.duration}}',
    },
    defaultEvents: ['timer.created', 'timer.expired', 'timer.replayed'],
  },
  {
    key: 'discord-basic',
    name: 'Discord – Timer Alerts',
    description: 'Sends concise lifecycle alerts to a Discord channel via webhook.',
    samplePayload: {
      content: '⏱️ Timer {{timer.name}} changed status to {{timer.status}}',
    },
    defaultEvents: ['timer.created', 'timer.expired'],
  },
  {
    key: 'teams-card',
    name: 'Microsoft Teams – Adaptive Card',
    description: 'Delivers adaptive card summaries for timer completions to Teams channels.',
    samplePayload: {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: 'Timer {{timer.name}} finished', weight: 'Bolder', size: 'Medium' },
              { type: 'TextBlock', text: 'Elapsed {{timer.duration}}', isSubtle: true },
            ],
          },
        },
      ],
    },
    defaultEvents: ['timer.expired'],
  },
];

function listWebhookTemplates() {
  return WEBHOOK_TEMPLATES.slice();
}

async function createWebhookFromTemplate(teamId, templateKey, overrides = {}) {
  const template = WEBHOOK_TEMPLATES.find((item) => item.key === templateKey);
  if (!template) {
    throw new Error('Unknown webhook template');
  }
  return registerWebhook(teamId, {
    url: overrides.url,
    description: overrides.description || template.name,
    events: overrides.events || template.defaultEvents,
    headers: overrides.headers || {},
    timeoutMs: overrides.timeoutMs,
    templateKey,
  });
}

module.exports = {
  registerWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  queueWebhookDelivery,
  publishEvent,
  dispatchQueuedDeliveries,
  triggerTestDelivery,
  getWebhookLogs,
  computeSignature,
  verifySignature,
  listWebhookTemplates,
  createWebhookFromTemplate,
  __setDb: setDbOverride,
};
