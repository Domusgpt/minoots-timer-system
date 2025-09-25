/**
 * MINOOTS Usage Tracking Utilities
 * Track user usage for tier enforcement and analytics
 */

const admin = require('firebase-admin');

// Get Firestore reference
let db;
const getDb = () => {
  if (!db) {
    db = admin.firestore();
  }
  return db;
};

/**
 * Get today's date string for usage tracking
 */
function getTodayString() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
}

/**
 * Track a request for rate limiting and analytics
 */
async function trackRequest(userId, endpoint, method) {
  const db = getDb();
  const today = getTodayString();
  const docId = `${userId}_${today}`;
  
  try {
    await db.collection('usage').doc(docId).set({
      userId: userId,
      date: today,
      requests: admin.firestore.FieldValue.increment(1),
      endpoints: admin.firestore.FieldValue.increment(1),
      [`${method.toLowerCase()}_${endpoint.replace(/\//g, '_')}`]: admin.firestore.FieldValue.increment(1),
      lastRequest: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Usage tracking error:', error);
    // Don't fail the request if usage tracking fails
  }
}

/**
 * Track timer creation specifically (for tier limits)
 */
async function trackTimerCreation(userId, timerData) {
  const db = getDb();
  const today = getTodayString();
  const docId = `${userId}_${today}`;
  
  try {
    await db.collection('usage').doc(docId).set({
      userId: userId,
      date: today,
      timersCreated: admin.firestore.FieldValue.increment(1),
      lastTimerCreated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Also track in monthly aggregation
    const monthKey = today.substring(0, 7); // YYYY-MM
    await db.collection('monthlyUsage').doc(`${userId}_${monthKey}`).set({
      userId: userId,
      month: monthKey,
      timersCreated: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
    
  } catch (error) {
    console.error('Timer tracking error:', error);
  }
}

/**
 * Check if user has exceeded their daily timer limit
 */
async function checkTimerLimit(userId, userTier) {
  const limits = {
    free: 100,      // 100 timers per day
    pro: -1,        // Unlimited
    team: -1,       // Unlimited
    enterprise: -1  // Unlimited
  };
  
  const dailyLimit = limits[userTier] || limits.free;
  
  // Unlimited tiers
  if (dailyLimit === -1) {
    return { allowed: true, limit: -1, used: 0 };
  }
  
  const db = getDb();
  const today = getTodayString();
  const docId = `${userId}_${today}`;
  
  try {
    const usageDoc = await db.collection('usage').doc(docId).get();
    const timersUsed = usageDoc.exists ? (usageDoc.data().timersCreated || 0) : 0;
    
    return {
      allowed: timersUsed < dailyLimit,
      limit: dailyLimit,
      used: timersUsed,
      remaining: Math.max(0, dailyLimit - timersUsed)
    };
  } catch (error) {
    console.error('Timer limit check error:', error);
    // Allow the request if we can't check (fail open)
    return { allowed: true, limit: dailyLimit, used: 0 };
  }
}

/**
 * Get user usage statistics
 */
async function getUserUsageStats(userId, days = 7) {
  const db = getDb();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  
  try {
    const usageSnapshot = await db.collection('usage')
      .where('userId', '==', userId)
      .where('date', '>=', startDate.toISOString().split('T')[0])
      .where('date', '<=', endDate.toISOString().split('T')[0])
      .get();
    
    let totalRequests = 0;
    let totalTimers = 0;
    const dailyStats = {};
    
    usageSnapshot.docs.forEach(doc => {
      const data = doc.data();
      totalRequests += data.requests || 0;
      totalTimers += data.timersCreated || 0;
      
      dailyStats[data.date] = {
        requests: data.requests || 0,
        timers: data.timersCreated || 0
      };
    });
    
    return {
      totalRequests,
      totalTimers,
      dailyStats,
      averageRequestsPerDay: Math.round(totalRequests / days),
      averageTimersPerDay: Math.round(totalTimers / days)
    };
  } catch (error) {
    console.error('Usage stats error:', error);
    return {
      totalRequests: 0,
      totalTimers: 0,
      dailyStats: {},
      averageRequestsPerDay: 0,
      averageTimersPerDay: 0
    };
  }
}

/**
 * Check if user has concurrent timer limit
 */
async function checkConcurrentTimerLimit(userId, userTier) {
  const limits = {
    free: 5,        // 5 concurrent timers
    pro: -1,        // Unlimited
    team: -1,       // Unlimited
    enterprise: -1  // Unlimited
  };
  
  const concurrentLimit = limits[userTier] || limits.free;
  
  // Unlimited tiers
  if (concurrentLimit === -1) {
    return { allowed: true, limit: -1, current: 0 };
  }
  
  const db = getDb();
  
  try {
    // Count active timers for this user
    const activeTimersSnapshot = await db.collection('timers')
      .where('agentId', '==', userId)
      .where('status', '==', 'running')
      .get();
    
    const currentCount = activeTimersSnapshot.size;
    
    return {
      allowed: currentCount < concurrentLimit,
      limit: concurrentLimit,
      current: currentCount,
      remaining: Math.max(0, concurrentLimit - currentCount)
    };
  } catch (error) {
    console.error('Concurrent timer check error:', error);
    // Allow the request if we can't check
    return { allowed: true, limit: concurrentLimit, current: 0 };
  }
}

/**
 * Middleware to track usage automatically
 */
const usageTrackingMiddleware = async (req, res, next) => {
  // Only track for authenticated users
  if (req.user?.id) {
    // Track in background, don't block request
    setImmediate(() => {
      trackRequest(req.user.id, req.path, req.method);
    });
  }
  next();
};

module.exports = {
  trackRequest,
  trackTimerCreation,
  checkTimerLimit,
  checkConcurrentTimerLimit,
  getUserUsageStats,
  usageTrackingMiddleware
};