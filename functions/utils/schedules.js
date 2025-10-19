const { randomUUID } = require('crypto');
const admin = require('firebase-admin');
const cronParser = require('cron-parser');
const { instantiateTemplate } = require('./templates');

function getDb() {
  return admin.firestore();
}

function computeNextRun(cron, fromDate = new Date()) {
  const interval = cronParser.parseExpression(cron, { currentDate: fromDate });
  return interval.next().toDate();
}

async function createSchedule(teamId, schedule, actorId) {
  if (!schedule.cron) {
    throw new Error('cron expression is required');
  }
  if (!schedule.timer && !schedule.templateId) {
    throw new Error('timer configuration or templateId required');
  }

  const db = getDb();
  const scheduleId = schedule.id || randomUUID();
  const ref = db.collection('teams').doc(teamId).collection('schedules').doc(scheduleId);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const nextRunAt = computeNextRun(schedule.cron, new Date());

  const record = {
    id: scheduleId,
    teamId,
    name: schedule.name || 'Scheduled Timer',
    cron: schedule.cron,
    templateId: schedule.templateId || null,
    timer: schedule.timer || null,
    paused: schedule.paused || false,
    nextRunAt: admin.firestore.Timestamp.fromDate(nextRunAt),
    lastRunAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: actorId || null,
    updatedBy: actorId || null,
  };

  await ref.set(record, { merge: true });
  return { ...record, nextRunAt };
}

async function listSchedules(teamId) {
  const db = getDb();
  const snapshot = await db.collection('teams').doc(teamId).collection('schedules').orderBy('nextRunAt', 'asc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function updateSchedule(teamId, scheduleId, updates, actorId) {
  const db = getDb();
  const ref = db.collection('teams').doc(teamId).collection('schedules').doc(scheduleId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new Error('Schedule not found');
  }
  const data = doc.data();
  const nextRunAt = updates.cron ? computeNextRun(updates.cron) : data.nextRunAt?.toDate?.() || new Date();
  const payload = {
    ...updates,
    nextRunAt: admin.firestore.Timestamp.fromDate(nextRunAt),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorId || null,
  };
  await ref.set(payload, { merge: true });
  return { ...data, ...updates, nextRunAt };
}

async function deleteSchedule(teamId, scheduleId) {
  const db = getDb();
  await db.collection('teams').doc(teamId).collection('schedules').doc(scheduleId).delete();
}

async function getDueSchedules(limit = 20) {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  const snapshot = await db
    .collectionGroup('schedules')
    .where('paused', '==', false)
    .where('nextRunAt', '<=', now)
    .orderBy('nextRunAt', 'asc')
    .limit(limit)
    .get();
  return snapshot.docs;
}

async function markScheduleRun(scheduleDoc) {
  const data = scheduleDoc.data();
  const nextRun = computeNextRun(data.cron, new Date());
  await scheduleDoc.ref.set({
    lastRunAt: data.nextRunAt,
    nextRunAt: admin.firestore.Timestamp.fromDate(nextRun),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function materializeSchedule(scheduleDoc) {
  const data = scheduleDoc.data();
  if (data.templateId) {
    return instantiateTemplate(data.teamId, data.templateId, data.timer || {});
  }
  return { ...data.timer, team: data.teamId };
}

module.exports = {
  createSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  getDueSchedules,
  markScheduleRun,
  materializeSchedule,
};
