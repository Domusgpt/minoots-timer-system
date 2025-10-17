const { randomUUID } = require('crypto');
const admin = require('firebase-admin');

function getDb() {
  return admin.firestore();
}

async function createTemplate(teamId, template, actorId) {
  const db = getDb();
  const templateId = template.id || randomUUID();
  const ref = db.collection('teams').doc(teamId).collection('timerTemplates').doc(templateId);
  const existing = await ref.get();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const record = {
    id: templateId,
    teamId,
    name: template.name || 'Untitled Template',
    description: template.description || '',
    config: template.config || {},
    updatedAt: timestamp,
    createdAt: existing.exists ? existing.data().createdAt || timestamp : timestamp,
    updatedBy: actorId || null,
  };

  await ref.set(record, { merge: true });
  return { ...record, createdAt: existing.exists ? existing.data().createdAt : new Date() };
}

async function listTemplates(teamId) {
  const db = getDb();
  const snapshot = await db.collection('teams').doc(teamId).collection('timerTemplates').orderBy('name').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function deleteTemplate(teamId, templateId) {
  const db = getDb();
  await db.collection('teams').doc(teamId).collection('timerTemplates').doc(templateId).delete();
}

async function instantiateTemplate(teamId, templateId, overrides = {}) {
  const db = getDb();
  const doc = await db.collection('teams').doc(teamId).collection('timerTemplates').doc(templateId).get();
  if (!doc.exists) {
    throw new Error('Template not found');
  }
  const template = doc.data();
  return {
    ...template.config,
    ...overrides,
    name: overrides.name || template.config?.name || template.name,
    team: teamId,
    templateId,
  };
}

module.exports = {
  createTemplate,
  listTemplates,
  deleteTemplate,
  instantiateTemplate,
};
