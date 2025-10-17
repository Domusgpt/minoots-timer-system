const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

function getDb() {
  return admin.firestore();
}

function toTimestamp(date) {
  return admin.firestore.Timestamp.fromDate(date);
}

async function createTeam({ name, ownerId, plan = 'team', metadata = {} }) {
  if (!ownerId) {
    throw new Error('ownerId is required to create a team');
  }
  const db = getDb();
  const teamId = uuidv4();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const teamData = {
    name: name || 'Untitled Team',
    plan,
    ownerId,
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.collection('teams').doc(teamId).set(teamData);
  await db.collection('teams').doc(teamId).collection('members').doc(ownerId).set({
    userId: ownerId,
    role: 'owner',
    inviterId: ownerId,
    joinedAt: timestamp,
  });

  return { id: teamId, ...teamData, role: 'owner' };
}

async function addMember(teamId, userId, role = 'member', inviterId) {
  const db = getDb();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('teams').doc(teamId).collection('members').doc(userId).set({
    userId,
    role,
    inviterId: inviterId || null,
    joinedAt: timestamp,
  }, { merge: true });
  return { teamId, userId, role };
}

async function updateMemberRole(teamId, userId, role) {
  const db = getDb();
  await db.collection('teams').doc(teamId).collection('members').doc(userId).set({
    role,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { teamId, userId, role };
}

async function removeMember(teamId, userId) {
  const db = getDb();
  await db.collection('teams').doc(teamId).collection('members').doc(userId).delete();
  return { teamId, userId };
}

async function createInvitation(teamId, { email, role = 'member', inviterId, expiresInMinutes = 60 * 24 * 7 }) {
  if (!email) {
    throw new Error('Email is required to invite a team member');
  }

  const db = getDb();
  const token = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const normalizedEmail = email.trim().toLowerCase();
  const invitation = {
    token,
    teamId,
    email: normalizedEmail,
    role,
    inviterId: inviterId || null,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: toTimestamp(expiresAt),
  };

  const batch = db.batch();
  const teamInviteRef = db.collection('teams').doc(teamId).collection('invitations').doc(token);
  const globalInviteRef = db.collection('team_invitations').doc(token);

  batch.set(teamInviteRef, invitation);
  batch.set(globalInviteRef, invitation);

  await batch.commit();

  return { ...invitation, createdAt: now, updatedAt: now, expiresAt };
}

async function listInvitations(teamId) {
  const db = getDb();
  const snapshot = await db.collection('teams').doc(teamId).collection('invitations').get();
  return snapshot.docs.map((doc) => ({ token: doc.id, ...doc.data() }));
}

async function getInvitation(token) {
  const db = getDb();
  const doc = await db.collection('team_invitations').doc(token).get();
  if (!doc.exists) {
    return null;
  }
  return { token: doc.id, ...doc.data() };
}

async function updateInvitationStatus(token, updates) {
  const db = getDb();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const finalUpdates = { ...updates, updatedAt: timestamp };

  const inviteDoc = await db.collection('team_invitations').doc(token).get();
  if (!inviteDoc.exists) {
    return;
  }
  const teamId = inviteDoc.data().teamId;

  const batch = db.batch();
  batch.set(inviteDoc.ref, finalUpdates, { merge: true });
  if (teamId) {
    batch.set(
      db.collection('teams').doc(teamId).collection('invitations').doc(token),
      finalUpdates,
      { merge: true }
    );
  }
  await batch.commit();
}

async function acceptInvitation(token, { userId, email }) {
  const invitation = await getInvitation(token);
  if (!invitation) {
    throw new Error('Invitation not found or already processed');
  }

  const now = new Date();
  const expiresAt = invitation.expiresAt?.toDate?.() || null;
  if (expiresAt && expiresAt < now) {
    await updateInvitationStatus(token, { status: 'expired' });
    throw new Error('Invitation has expired');
  }

  const normalizedEmail = (email || '').trim().toLowerCase();
  if (invitation.email && normalizedEmail && invitation.email !== normalizedEmail) {
    throw new Error('Invitation email does not match the authenticated user');
  }

  await addMember(invitation.teamId, userId, invitation.role || 'member', invitation.inviterId || null);
  await updateInvitationStatus(token, {
    status: 'accepted',
    acceptedBy: userId,
    acceptedAt: toTimestamp(now),
  });

  return { teamId: invitation.teamId, role: invitation.role || 'member' };
}

async function revokeInvitation(teamId, token, actorId) {
  const invitation = await getInvitation(token);
  if (!invitation || invitation.teamId !== teamId) {
    throw new Error('Invitation not found for this team');
  }

  if (invitation.status !== 'pending') {
    return invitation;
  }

  await updateInvitationStatus(token, {
    status: 'revoked',
    revokedBy: actorId || null,
    revokedAt: toTimestamp(new Date()),
  });

  return { teamId, token, status: 'revoked' };
}

async function getTimer(timerId) {
  const db = getDb();
  const doc = await db.collection('timers').doc(timerId).get();
  if (!doc.exists) {
    return null;
  }
  return { id: doc.id, ...doc.data() };
}

async function ensureTeamTimer(teamId, timerId) {
  const timer = await getTimer(timerId);
  if (!timer) {
    throw new Error('Timer not found');
  }

  if (timer.team && timer.team !== teamId) {
    throw new Error('Timer is assigned to another team');
  }

  return timer;
}

async function shareTimerWithTeam(teamId, timerId, { addedBy, accessLevel = 'editor', collaborators = [] } = {}) {
  const db = getDb();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const timer = await ensureTeamTimer(teamId, timerId);

  const collaboratorMap = {};
  for (const collaborator of collaborators) {
    if (!collaborator || !collaborator.userId) continue;
    collaboratorMap[collaborator.userId] = collaborator.role || 'viewer';
  }

  const teamRef = db.collection('teams').doc(teamId);
  const shareRef = teamRef.collection('sharedTimers').doc(timerId);
  const shareDoc = await shareRef.get();
  const timerRef = db.collection('timers').doc(timerId);

  const update = {
    team: teamId,
    collaborators: admin.firestore.FieldValue.delete(),
    updatedAt: timestamp,
  };

  if (Object.keys(collaboratorMap).length > 0) {
    update.collaborators = collaboratorMap;
  }

  const batch = db.batch();
  batch.set(timerRef, update, { merge: true });
  batch.set(
    shareRef,
    {
      timerId,
      accessLevel,
      addedBy: addedBy || null,
      createdAt: shareDoc.exists ? shareDoc.data().createdAt || timestamp : timestamp,
      updatedAt: timestamp,
      collaborators: collaboratorMap,
      timerName: timer.name || timerId,
      duration: timer.duration || null,
      status: timer.status || 'running',
    },
    { merge: true }
  );

  await batch.commit();

  return { timerId, accessLevel, collaborators: collaboratorMap };
}

async function updateTimerCollaborator(teamId, timerId, userId, role) {
  const db = getDb();
  await ensureTeamTimer(teamId, timerId);

  const timerRef = db.collection('timers').doc(timerId);
  const shareRef = db.collection('teams').doc(teamId).collection('sharedTimers').doc(timerId);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const updates = {
    [`collaborators.${userId}`]: role,
    updatedAt: timestamp,
  };

  const batch = db.batch();
  batch.set(timerRef, updates, { merge: true });
  batch.set(shareRef, updates, { merge: true });
  await batch.commit();
  return { timerId, userId, role };
}

async function removeTimerCollaborator(teamId, timerId, userId) {
  const db = getDb();
  await ensureTeamTimer(teamId, timerId);

  const timerRef = db.collection('timers').doc(timerId);
  const shareRef = db.collection('teams').doc(teamId).collection('sharedTimers').doc(timerId);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(
    timerRef,
    {
      [`collaborators.${userId}`]: admin.firestore.FieldValue.delete(),
      updatedAt: timestamp,
    },
    { merge: true }
  );
  batch.set(
    shareRef,
    {
      [`collaborators.${userId}`]: admin.firestore.FieldValue.delete(),
      updatedAt: timestamp,
    },
    { merge: true }
  );
  await batch.commit();
  return { timerId, userId };
}

async function unshareTimer(teamId, timerId) {
  const db = getDb();
  await ensureTeamTimer(teamId, timerId);

  const timerRef = db.collection('timers').doc(timerId);
  const shareRef = db.collection('teams').doc(teamId).collection('sharedTimers').doc(timerId);

  const batch = db.batch();
  batch.set(
    timerRef,
    {
      team: admin.firestore.FieldValue.delete(),
      collaborators: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  batch.delete(shareRef);
  await batch.commit();
  return { timerId };
}

async function listSharedTimers(teamId) {
  const db = getDb();
  const snapshot = await db.collection('teams').doc(teamId).collection('sharedTimers').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function listTeamsForUser(userId) {
  const db = getDb();
  const snapshot = await db.collectionGroup('members').where('userId', '==', userId).get();
  const teams = [];
  for (const doc of snapshot.docs) {
    const teamRef = doc.ref.parent.parent;
    if (!teamRef) continue;
    const teamSnap = await teamRef.get();
    if (!teamSnap.exists) continue;
    teams.push({
      id: teamRef.id,
      role: doc.data().role || 'member',
      name: teamSnap.data().name,
      plan: teamSnap.data().plan,
    });
  }
  return teams;
}

async function getTeam(teamId) {
  const db = getDb();
  const doc = await db.collection('teams').doc(teamId).get();
  if (!doc.exists) {
    return null;
  }
  return { id: doc.id, ...doc.data() };
}

module.exports = {
  createTeam,
  addMember,
  updateMemberRole,
  removeMember,
  createInvitation,
  listInvitations,
  acceptInvitation,
  revokeInvitation,
  listTeamsForUser,
  getTeam,
  shareTimerWithTeam,
  updateTimerCollaborator,
  removeTimerCollaborator,
  unshareTimer,
  listSharedTimers,
};
