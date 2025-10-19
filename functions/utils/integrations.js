const admin = require('firebase-admin');

const SUPPORTED_TYPES = new Set(['slack', 'discord', 'teams', 'telegram', 'email', 'sms', 'voice']);

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

function maskSecret(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  if (value.length <= 10) {
    return `${value.slice(0, 3)}***`;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function sanitizeConfig(doc) {
  const result = { ...doc };
  if (result.webhookUrl) {
    result.webhookPreview = maskSecret(result.webhookUrl);
    delete result.webhookUrl;
  }
  if (result.botToken) {
    result.botTokenPreview = maskSecret(result.botToken);
    delete result.botToken;
  }
  if (result.apiKey) {
    result.apiKeyPreview = maskSecret(result.apiKey);
    delete result.apiKey;
  }
  if (result.authToken) {
    result.authTokenPreview = maskSecret(result.authToken);
    delete result.authToken;
  }
  if (result.smtp) {
    const smtp = { ...result.smtp };
    if (smtp.password) {
      smtp.passwordPreview = maskSecret(smtp.password);
      delete smtp.password;
    }
    result.smtp = smtp;
  }
  return result;
}

function validateType(type) {
  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`Unsupported integration type: ${type}`);
  }
}

async function saveIntegration(teamId, type, config = {}) {
  validateType(type);
  const db = getDb();
  const now = nowMs();
  const ref = db.collection('integration_configs').doc(`${teamId}_${type}`);
  const record = {
    teamId,
    type,
    configuration: { ...config },
    updatedAt: now,
    createdAt: now,
  };
  const existing = await ref.get();
  if (existing.exists) {
    record.createdAt = existing.data().createdAt || now;
  }
  await ref.set(record);
  return {
    id: ref.id,
    teamId,
    type,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    configuration: sanitizeConfig(record.configuration),
  };
}

async function listIntegrations(teamId) {
  const db = getDb();
  const snapshot = await db.collection('integration_configs').where('teamId', '==', teamId).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      teamId: data.teamId,
      type: data.type,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      configuration: sanitizeConfig(data.configuration || {}),
    };
  });
}

async function getIntegration(teamId, type, { includeSecrets = false } = {}) {
  validateType(type);
  const db = getDb();
  const doc = await db.collection('integration_configs').doc(`${teamId}_${type}`).get();
  if (!doc.exists) {
    return null;
  }
  const data = doc.data();
  if (data.teamId !== teamId) {
    return null;
  }
  if (includeSecrets) {
    return { id: doc.id, ...data };
  }
  return {
    id: doc.id,
    teamId: data.teamId,
    type: data.type,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    configuration: sanitizeConfig(data.configuration || {}),
  };
}

async function deleteIntegration(teamId, type) {
  validateType(type);
  const db = getDb();
  const ref = db.collection('integration_configs').doc(`${teamId}_${type}`);
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

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text };
}

async function postForm(url, params, headers = {}) {
  const body = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString(),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text };
}

async function sendSlackNotification(config, message) {
  return postJson(config.webhookUrl, {
    text: typeof message === 'string' ? message : message.text || message.summary || 'Minoots timer update',
    attachments: message.attachments,
    blocks: message.blocks,
  });
}

async function sendDiscordNotification(config, message) {
  return postJson(config.webhookUrl, {
    content: typeof message === 'string' ? message : message.text || message.summary || 'Minoots timer update',
    embeds: message.embeds,
  });
}

async function sendTeamsNotification(config, message) {
  return postJson(config.webhookUrl, {
    type: 'message',
    text: typeof message === 'string' ? message : message.text || message.summary || 'Minoots timer update',
    attachments: message.attachments,
  });
}

async function sendTelegramNotification(config, message) {
  const body = {
    chat_id: config.chatId,
    text: typeof message === 'string' ? message : message.text || message.summary || 'Minoots timer update',
    parse_mode: message.parseMode || 'Markdown',
  };
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  return postJson(url, body);
}

async function sendEmailNotification(config, message) {
  if (config.provider === 'sendgrid') {
    return postJson(
      'https://api.sendgrid.com/v3/mail/send',
      {
        personalizations: [
          {
            to: [{ email: config.to }],
            subject: message.subject || 'Minoots timer update',
          },
        ],
        from: { email: config.from },
        content: [
          {
            type: 'text/plain',
            value: typeof message === 'string' ? message : message.text || message.summary || 'Timer update',
          },
        ],
      },
      { Authorization: `Bearer ${config.apiKey}` }
    );
  }
  throw new Error('Unsupported email provider');
}

async function sendSmsNotification(config, message) {
  const accountSid = config.accountSid;
  const authToken = config.authToken;
  if (!accountSid || !authToken) {
    throw new Error('SMS integration requires accountSid and authToken');
  }
  if (!config.from || !config.to) {
    throw new Error('SMS integration requires from and to numbers');
  }
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const payload = new URLSearchParams({
    From: config.from,
    To: config.to,
    Body: typeof message === 'string' ? message : message.text || message.summary || 'Minoots timer update',
  });
  return postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    payload,
    { Authorization: `Basic ${auth}` }
  );
}

async function sendVoiceNotification(config, message) {
  const accountSid = config.accountSid;
  const authToken = config.authToken;
  if (!accountSid || !authToken) {
    throw new Error('Voice integration requires accountSid and authToken');
  }
  if (!config.from || !config.to) {
    throw new Error('Voice integration requires from and to numbers');
  }
  const spoken = typeof message === 'string' ? message : message.text || message.summary || 'Minoots timer update';
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const twiml = `<Response><Say>${spoken}</Say></Response>`;
  const payload = new URLSearchParams({
    From: config.from,
    To: config.to,
    Twiml: twiml,
  });
  return postForm(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    payload,
    { Authorization: `Basic ${auth}` }
  );
}

async function sendIntegrationNotification(teamId, type, message = {}) {
  const integration = await getIntegration(teamId, type, { includeSecrets: true });
  if (!integration) {
    throw new Error('Integration not configured');
  }
  const config = integration.configuration || {};
  switch (type) {
    case 'slack':
      return sendSlackNotification(config, message);
    case 'discord':
      return sendDiscordNotification(config, message);
    case 'teams':
      return sendTeamsNotification(config, message);
    case 'telegram':
      return sendTelegramNotification(config, message);
    case 'email':
      return sendEmailNotification(config, message);
    case 'sms':
      return sendSmsNotification(config, message);
    case 'voice':
      return sendVoiceNotification(config, message);
    default:
      throw new Error('Unsupported integration type');
  }
}

async function sendIntegrationTest(teamId, type) {
  const payload = {
    summary: 'Minoots integration test',
    text: 'This is a synthetic message confirming integration connectivity.',
    subject: 'Minoots integration test',
  };
  return sendIntegrationNotification(teamId, type, payload);
}

module.exports = {
  saveIntegration,
  listIntegrations,
  getIntegration,
  deleteIntegration,
  sendIntegrationNotification,
  sendIntegrationTest,
  __setDb: setDbOverride,
};
