/**
 * MINOOTS Rate Limiting Middleware
 * Tier-based rate limiting to prevent abuse
 * 
 * Tiers:
 * - Free: 10 requests per minute
 * - Pro: 100 requests per minute  
 * - Team: 500 requests per minute
 * - Enterprise: 1000 requests per minute
 */

const rateLimit = require('express-rate-limit');

// Rate limit configurations per tier
const tierLimits = {
  free: {
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Rate limit exceeded (10 requests per minute). Upgrade to Pro for higher limits.'
  },
  pro: {
    windowMs: 60 * 1000,
    max: 100,
    message: 'Rate limit exceeded (100 requests per minute). Contact support if you need higher limits.'
  },
  team: {
    windowMs: 60 * 1000,
    max: 500,
    message: 'Rate limit exceeded (500 requests per minute). Contact support for enterprise options.'
  },
  enterprise: {
    windowMs: 60 * 1000,
    max: 1000,
    message: 'Rate limit exceeded. Please contact your account manager.'
  }
};

/**
 * Pre-created rate limiters for each tier (FIXED: created at module load, not per request)
 */
const tierLimiters = {};

// Create all rate limiters at module initialization
Object.keys(tierLimits).forEach(tier => {
  const config = tierLimits[tier];
  
  tierLimiters[tier] = rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: {
      success: false,
      error: config.message,
      retryAfter: config.windowMs / 1000 + ' seconds'
    },
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    // Use user ID for authenticated requests, IP for anonymous
    keyGenerator: (req) => {
      if (req.user?.id) {
        return `user_${req.user.id}`;
      }
      // For unauthenticated requests, use IP (with fallback for Firebase Functions)
      const clientIP = req.ip || 
                      req.connection?.remoteAddress || 
                      req.socket?.remoteAddress ||
                      req.headers['x-forwarded-for']?.split(',')[0] ||
                      'unknown-ip';
      return `ip_${clientIP}`;
    },
    handler: (req, res) => {
      // FIXED: Safe access to rateLimit properties for Firebase Functions
      const retryAfter = req.rateLimit?.resetTime 
        ? Math.round(req.rateLimit.resetTime / 1000)
        : Math.round(config.windowMs / 1000);
        
      res.status(429).json({
        success: false,
        error: config.message,
        tier: tier,
        limit: config.max,
        windowMs: config.windowMs,
        retryAfter: retryAfter,
        upgradeUrl: tier === 'free' ? 'https://github.com/Domusgpt/minoots-timer-system#pricing' : null
      });
    }
  });
});

/**
 * Dynamic rate limiting middleware
 * FIXED: Uses pre-created limiters instead of creating them per request
 */
const dynamicRateLimiter = (req, res, next) => {
  // Skip rate limiting for health checks
  if (req.path === '/health') {
    return next();
  }

  // Get user tier, default to free
  const userTier = req.user?.tier || 'free';
  
  // Use pre-created limiter (FIXED: no longer creates limiter during request)
  const limiter = tierLimiters[userTier] || tierLimiters.free;
  limiter(req, res, next);
};

/**
 * Special rate limiters for expensive operations (timer creation)
 * FIXED: Pre-created limiters for each tier to avoid dynamic max() functions
 */
const expensiveLimits = {
  free: 2,        // 2 timer creations per minute
  pro: 20,        // 20 timer creations per minute
  team: 50,       // 50 timer creations per minute
  enterprise: 100 // 100 timer creations per minute
};

const expensiveLimiters = {};

// Create rate limiters for each tier at module initialization
Object.keys(expensiveLimits).forEach(tier => {
  expensiveLimiters[tier] = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: expensiveLimits[tier],
    message: {
      success: false,
      error: `Too many timer creation requests (${expensiveLimits[tier]}/minute). Please wait before creating more timers.`,
      tier: tier,
      limit: expensiveLimits[tier]
    },
    keyGenerator: (req) => {
      if (req.user?.id) {
        return `expensive_${req.user.id}`;
      }
      // Fix for Firebase Functions IP detection
      const clientIP = req.ip || 
                      req.connection?.remoteAddress || 
                      req.socket?.remoteAddress ||
                      req.headers['x-forwarded-for']?.split(',')[0] ||
                      'unknown-ip';
      return `expensive_${clientIP}`;
    }
  });
});

/**
 * Dynamic expensive operation limiter middleware
 * FIXED: Uses pre-created limiters instead of dynamic max() function
 */
const expensiveOperationLimiter = (req, res, next) => {
  const userTier = req.user?.tier || 'free';
  const limiter = expensiveLimiters[userTier] || expensiveLimiters.free;
  limiter(req, res, next);
};

module.exports = {
  dynamicRateLimiter,
  expensiveOperationLimiter,
  tierLimiters // Export pre-created limiters for testing
};