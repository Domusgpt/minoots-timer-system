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
      // For unauthenticated requests, use IP
      return req.ip || req.connection.remoteAddress;
    },
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: config.message,
        tier: tier,
        limit: config.max,
        windowMs: config.windowMs,
        retryAfter: Math.round(req.rateLimit.resetTime / 1000),
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
 * Special rate limiter for expensive operations
 * More restrictive limits for operations like timer creation
 */
const expensiveOperationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => {
    // Dynamic limits based on tier
    const limits = {
      free: 2,    // 2 timer creations per minute
      pro: 20,    // 20 timer creations per minute
      team: 50,   // 50 timer creations per minute
      enterprise: 100 // 100 timer creations per minute
    };
    return limits[req.user?.tier || 'free'];
  },
  message: {
    success: false,
    error: 'Too many timer creation requests. Please wait before creating more timers.'
  },
  keyGenerator: (req) => {
    if (req.user?.id) {
      return `expensive_${req.user.id}`;
    }
    return `expensive_${req.ip}`;
  }
});

module.exports = {
  dynamicRateLimiter,
  expensiveOperationLimiter,
  tierLimiters // Export pre-created limiters for testing
};