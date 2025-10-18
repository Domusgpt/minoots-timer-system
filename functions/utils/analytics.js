const admin = require('firebase-admin');

function getDb() {
  return admin.firestore();
}

async function getTeamUsageSummary(teamId) {
  const db = getDb();
  const timersSnap = await db.collection('timers').where('team', '==', teamId).get();
  const now = Date.now();
  let active = 0;
  let expired = 0;
  let paused = 0;
  let totalDuration = 0;
  let totalElapsed = 0;

  timersSnap.forEach((doc) => {
    const data = doc.data();
    totalDuration += data.duration || 0;
    const status = data.status || 'running';
    if (status === 'running') {
      active += 1;
      totalElapsed += Math.max(0, now - (data.startTime || now));
    } else if (status === 'expired') {
      expired += 1;
      totalElapsed += data.duration || 0;
    } else if (status === 'paused') {
      paused += 1;
      totalElapsed += Math.max(0, (data.pausedAt || now) - (data.startTime || now));
    }
  });

  const totalTimers = timersSnap.size;
  const averageDuration = totalTimers > 0 ? Math.round(totalDuration / totalTimers) : 0;

  const usageCollection = await db
    .collection('timer_logs')
    .where('team', '==', teamId)
    .where('timestamp', '>=', admin.firestore.Timestamp.fromMillis(now - 30 * 24 * 60 * 60 * 1000))
    .get();

  const last30DayEvents = usageCollection.docs.map((doc) => doc.data());

  return {
    teamId,
    totalTimers,
    active,
    expired,
    paused,
    totalDuration,
    averageDuration,
    totalElapsed,
    last30DayEvents,
  };
}

async function getTeamTimerHistory(teamId, { limit = 50, cursor } = {}) {
  const db = getDb();
  let query = db
    .collection('timer_logs')
    .where('team', '==', teamId)
    .orderBy('timestamp', 'desc')
    .limit(limit);

  if (cursor) {
    const cursorDoc = await db.collection('timer_logs').doc(cursor).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  const entries = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const nextCursor = entries.length === limit ? entries[entries.length - 1].id : null;

  return { entries, nextCursor };
}

async function getActiveTimerSnapshots(teamId) {
  const db = getDb();
  const activeTimers = await db
    .collection('timers')
    .where('team', '==', teamId)
    .where('status', '==', 'running')
    .orderBy('endTime', 'asc')
    .limit(25)
    .get();

  return activeTimers.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

module.exports = {
  getTeamUsageSummary,
  getTeamTimerHistory,
  getActiveTimerSnapshots,
};
