/**
 * MINOOTS Authentication Middleware
 * Handles both Firebase Auth tokens and API keys
 *
 * Free endpoints: /health, /pricing (no auth required)
 * All other endpoints require authentication
 */

const admin = require('firebase-admin');

// Initialize Firestore reference (will be set in onInit)
let db;

const ROLE_PRIORITY = { viewer: 0, member: 1, admin: 2, owner: 3 };

async function ensureDb() {
  if (!db) {
    db = admin.firestore();
  }
  return db;
}

async function loadUserTeams(userId) {
  if (!userId) return [];
  const database = await ensureDb();
  const snapshot = await database.collectionGroup('members').where('userId', '==', userId).get();
  const teams = [];
  snapshot.docs.forEach((doc) => {
    const teamRef = doc.ref.parent.parent;
    if (!teamRef) return;
    const data = doc.data() || {};
    teams.push({
      id: teamRef.id,
      role: data.role || 'member',
      joinedAt: data.joinedAt,
      inviterId: data.inviterId || null,
    });
  });
  return teams;
}

async function attachTeams(user) {
  if (!user) return user;
  if (user.isAnonymous) {
    user.teams = [];
    user.rolesByTeam = {};
    return user;
  }
  const teams = await loadUserTeams(user.id);
  user.teams = teams;
  user.rolesByTeam = teams.reduce((acc, team) => {
    acc[team.id] = team.role;
    return acc;
  }, {});
  return user;
}

function hasTeamRole(user, teamId, allowedRoles = ['member', 'admin', 'owner']) {
  if (!teamId || !user) return false;
  const role = user.rolesByTeam?.[teamId];
  if (!role) return false;
  const rank = ROLE_PRIORITY[role] ?? 0;
  return allowedRoles.some((allowed) => rank >= (ROLE_PRIORITY[allowed] ?? 0));
}

const requireTeamRole = (resolver, roles = ['member']) => {
  return async (req, res, next) => {
    const teamId = typeof resolver === 'function'
      ? resolver(req)
      : req.params[resolver] || req.body[resolver] || req.query[resolver];

    if (!teamId) {
      return res.status(400).json({ success: false, error: 'Team identifier required for this operation.' });
    }

    if (!hasTeamRole(req.user, teamId, roles)) {
      return res.status(403).json({ success: false, error: 'You do not have permission for this team.' });
    }

    next();
  };
};

/**
 * Main authentication middleware
 * FREEMIUM STRATEGY: Allow anonymous usage with limits, then require auth
 */
const authenticateUser = async (req, res, next) => {
  await ensureDb();

  // Free endpoints that don't need auth
  const freeEndpoints = ['/health', '/pricing', '/docs', '/sso'];
  if (freeEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
    return next();
  }

  // FREEMIUM: Check if this is anonymous usage
  const isAnonymous = !req.headers['x-api-key'] && !req.headers['authorization'];

  if (isAnonymous) {
    const anonymousUser = await handleAnonymousUser(req, res);
    if (anonymousUser) {
      req.user = anonymousUser;
      req.authMethod = 'anonymous';
      return next();
    }
    // If anonymous limit exceeded, fall through to require auth
  }

  try {
    // Check for API key first (simpler for developers)
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const user = await checkApiKey(apiKey);
      if (user) {
        req.user = await attachTeams(user);
        req.authMethod = 'apiKey';
        return next();
      }
    }

    // Check Firebase token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'You\'ve reached the anonymous usage limit! Sign up for unlimited timers.',
        anonymousLimit: true,
        upgradeMessage: 'Create account for unlimited timers + MCP integration',
        signupUrl: 'https://minoots.com/signup',
        docs: 'https://github.com/Domusgpt/minoots-timer-system#authentication'
      });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();

    if (!userDoc.exists) {
      const newUser = {
        id: decodedToken.uid,
        email: decodedToken.email || '',
        tier: 'free',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeen: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('users').doc(decodedToken.uid).set(newUser);
      req.user = await attachTeams(newUser);
    } else {
      await userDoc.ref.update({
        lastSeen: admin.firestore.FieldValue.serverTimestamp()
      });
      req.user = await attachTeams({ id: userDoc.id, ...userDoc.data() });
    }

    req.authMethod = 'firebase';
    next();
  } catch (error) {
    console.error('Auth error:', error);

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: 'Token expired. Please refresh your authentication.'
      });
    }

    res.status(401).json({
      success: false,
      error: 'Invalid authentication credentials'
    });
  }
};

/**
 * Handle anonymous users with freemium limits
 */
async function handleAnonymousUser(req, res) {
  try {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const today = new Date().toISOString().split('T')[0];
    const anonymousId = `anon_${clientIp}_${today}`;

    const usageDoc = await db.collection('anonymous_usage').doc(anonymousId).get();
    const currentUsage = usageDoc.exists ? usageDoc.data() : { timers: 0, requests: 0 };

    const ANONYMOUS_LIMITS = {
      dailyTimers: 5,
      dailyRequests: 50,
      maxDuration: '1h'
    };

    if (currentUsage.timers >= ANONYMOUS_LIMITS.dailyTimers) {
      res.set('X-Anonymous-Limit', 'reached');
      res.set('X-Upgrade-Message', 'Sign up for unlimited timers');
      return null;
    }

    if (currentUsage.requests >= ANONYMOUS_LIMITS.dailyRequests) {
      return null;
    }

    await db.collection('anonymous_usage').doc(anonymousId).set({
      timers: currentUsage.timers,
      requests: (currentUsage.requests || 0) + 1,
      lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      ip: clientIp,
      userAgent: req.headers['user-agent'] || 'unknown'
    }, { merge: true });

    res.set('X-Anonymous-Timers-Used', currentUsage.timers.toString());
    res.set('X-Anonymous-Timers-Remaining', (ANONYMOUS_LIMITS.dailyTimers - currentUsage.timers).toString());
    res.set('X-Upgrade-At', ANONYMOUS_LIMITS.dailyTimers.toString());

    return {
      id: anonymousId,
      email: 'anonymous',
      tier: 'anonymous',
      limits: ANONYMOUS_LIMITS,
      usage: currentUsage,
      isAnonymous: true,
      teams: [],
      rolesByTeam: {}
    };
  } catch (error) {
    console.error('Anonymous user handling error:', error);
    return null;
  }
}

/**
 * Check API key validity and get associated user
 */
async function checkApiKey(apiKey) {
  try {
    if (!apiKey.startsWith('mnt_')) {
      return null;
    }

    const doc = await db.collection('apiKeys').doc(apiKey).get();
    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    if (data.revoked) {
      return null;
    }

    await doc.ref.update({
      lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      totalRequests: admin.firestore.FieldValue.increment(1)
    });

    const user = {
      id: data.userId,
      email: data.userEmail,
      tier: data.userTier || 'free',
      apiKeyId: doc.id,
      apiKeyName: data.name,
      isApiKey: true
    };

    return attachTeams(user);
  } catch (error) {
    console.error('API key check error:', error);
    return null;
  }
}

const requireTier = (requiredTier) => {
  const tierHierarchy = { free: 0, pro: 1, team: 2, enterprise: 3 };

  return (req, res, next) => {
    const userTierLevel = tierHierarchy[req.user?.tier || 'free'];
    const requiredTierLevel = tierHierarchy[requiredTier];

    if (userTierLevel >= requiredTierLevel) {
      next();
    } else {
      res.status(403).json({
        success: false,
        error: `This feature requires ${requiredTier} tier or higher`,
        upgradeUrl: 'https://minoots.com/pricing'
      });
    }
  };
};

const setDb = (database) => {
  db = database;
};

module.exports = {
  authenticateUser,
  requireTier,
  requireTeamRole,
  hasTeamRole,
  loadUserTeams,
  setDb
};
