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

/**
 * Main authentication middleware
 * FREEMIUM STRATEGY: Allow anonymous usage with limits, then require auth
 */
const authenticateUser = async (req, res, next) => {
  // Initialize db if not already done
  if (!db) {
    db = admin.firestore();
  }

  // Free endpoints that don't need auth
  const freeEndpoints = ['/health', '/pricing', '/docs'];
  if (freeEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
    return next();
  }

  // FREEMIUM: Check if this is anonymous usage
  const isAnonymous = !req.headers['x-api-key'] && !req.headers['authorization'];
  
  if (isAnonymous) {
    // Allow anonymous usage with tracking
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
        req.user = user;
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
      // Create user if first time
      const newUser = {
        id: decodedToken.uid,
        email: decodedToken.email || '',
        tier: 'free',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeen: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection('users').doc(decodedToken.uid).set(newUser);
      req.user = newUser;
    } else {
      // Update last seen
      await userDoc.ref.update({
        lastSeen: admin.firestore.FieldValue.serverTimestamp()
      });
      req.user = { id: userDoc.id, ...userDoc.data() };
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
 * Track usage by IP address with generous but limited access
 */
async function handleAnonymousUser(req, res) {
  try {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const today = new Date().toISOString().split('T')[0];
    const anonymousId = `anon_${clientIp}_${today}`;
    
    // Check current anonymous usage
    const usageDoc = await db.collection('anonymous_usage').doc(anonymousId).get();
    const currentUsage = usageDoc.exists ? usageDoc.data() : { timers: 0, requests: 0 };
    
    // Freemium limits for anonymous users
    const ANONYMOUS_LIMITS = {
      dailyTimers: 5,
      dailyRequests: 50,
      maxDuration: '1h' // 1 hour max timer duration
    };
    
    // Check if limits exceeded
    if (currentUsage.timers >= ANONYMOUS_LIMITS.dailyTimers) {
      // Add soft limit warning to response headers
      res.set('X-Anonymous-Limit', 'reached');
      res.set('X-Upgrade-Message', 'Sign up for unlimited timers');
      return null; // Require auth
    }
    
    if (currentUsage.requests >= ANONYMOUS_LIMITS.dailyRequests) {
      return null; // Require auth
    }
    
    // Update usage tracking
    await db.collection('anonymous_usage').doc(anonymousId).set({
      timers: currentUsage.timers,
      requests: (currentUsage.requests || 0) + 1,
      lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      ip: clientIp,
      userAgent: req.headers['user-agent'] || 'unknown'
    }, { merge: true });
    
    // Add helpful headers
    res.set('X-Anonymous-Timers-Used', currentUsage.timers.toString());
    res.set('X-Anonymous-Timers-Remaining', (ANONYMOUS_LIMITS.dailyTimers - currentUsage.timers).toString());
    res.set('X-Upgrade-At', ANONYMOUS_LIMITS.dailyTimers.toString());
    
    // Return anonymous user object
    return {
      id: anonymousId,
      email: 'anonymous',
      tier: 'anonymous',
      limits: ANONYMOUS_LIMITS,
      usage: currentUsage,
      isAnonymous: true
    };
  } catch (error) {
    console.error('Anonymous user handling error:', error);
    return null; // Fall back to requiring auth
  }
}

/**
 * Check API key validity and get associated user
 */
async function checkApiKey(apiKey) {
  try {
    // API keys should start with 'mnt_' for security
    if (!apiKey.startsWith('mnt_')) {
      return null;
    }

    const doc = await db.collection('apiKeys').doc(apiKey).get();
    if (!doc.exists) {
      return null;
    }
    
    const data = doc.data();
    
    // Check if key is revoked
    if (data.revoked) {
      return null;
    }
    
    // Update usage stats
    await doc.ref.update({
      lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      totalRequests: admin.firestore.FieldValue.increment(1)
    });
    
    // Return user data associated with this API key
    return {
      id: data.userId,
      email: data.userEmail,
      tier: data.userTier || 'free',
      apiKeyName: data.name
    };
  } catch (error) {
    console.error('API key check error:', error);
    return null;
  }
}

/**
 * Middleware to check if user has required tier
 */
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

/**
 * Set db reference (called from main index.js)
 */
const setDb = (database) => {
  db = database;
};

module.exports = {
  authenticateUser,
  requireTier,
  setDb
};