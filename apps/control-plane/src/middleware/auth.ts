import { Request, Response, NextFunction } from 'express';
import { logger } from '../telemetry/logger';

interface User {
  id: string;
  tier: 'free' | 'pro' | 'team';
}

// Simple in-memory API key store (TODO: Replace with database)
const apiKeys = new Map<string, User>([
  // Demo keys for testing
  ['mnt_demo_key_free', { id: 'demo-user-1', tier: 'free' }],
  ['mnt_demo_key_pro', { id: 'demo-user-2', tier: 'pro' }],
  ['mnt_demo_key_team', { id: 'demo-user-3', tier: 'team' }],
]);

// Request rate limiting (simple in-memory)
const rateLimits = new Map<string, { count: number; resetAt: number }>();

export interface AuthenticatedRequest extends Request {
  user: User;
}

export const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
  // Skip auth for health check
  if (req.path === '/healthz') {
    return next();
  }

  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key required',
      message: 'Include X-API-Key header with your request',
      docs: 'https://github.com/Domusgpt/minoots-timer-system#authentication'
    });
  }

  if (!apiKey.startsWith('mnt_')) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key format',
      message: 'API keys must start with "mnt_"'
    });
  }

  const user = apiKeys.get(apiKey);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      message: 'API key not found or revoked'
    });
  }

  // Add user to request
  (req as AuthenticatedRequest).user = user;

  logger.info({ userId: user.id, tier: user.tier }, 'User authenticated');
  next();
};

export const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return next(); // Should never happen if auth middleware runs first
  }

  const now = Date.now();
  const userId = user.id;
  const limit = rateLimits.get(userId);

  // Rate limits by tier
  const tierLimits = {
    free: 100,    // 100 requests per minute
    pro: 1000,    // 1000 requests per minute
    team: 5000    // 5000 requests per minute
  };

  const userLimit = tierLimits[user.tier];

  if (!limit || limit.resetAt < now) {
    // Reset or initialize rate limit
    rateLimits.set(userId, { count: 1, resetAt: now + 60000 }); // 1 minute window
    return next();
  }

  if (limit.count >= userLimit) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: `${user.tier} tier allows ${userLimit} requests per minute`,
      retryAfter: Math.ceil((limit.resetAt - now) / 1000)
    });
  }

  limit.count++;
  next();
};

export const requireTier = (requiredTier: 'free' | 'pro' | 'team') => {
  const tierLevels = { free: 0, pro: 1, team: 2 };

  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userLevel = tierLevels[user.tier];
    const requiredLevel = tierLevels[requiredTier];

    if (userLevel >= requiredLevel) {
      next();
    } else {
      res.status(403).json({
        success: false,
        error: `This feature requires ${requiredTier} tier or higher`,
        currentTier: user.tier,
        upgradeUrl: 'https://minoots.com/pricing'
      });
    }
  };
};

// Utility function to generate new API keys
export const generateApiKey = (userId: string, tier: 'free' | 'pro' | 'team' = 'free'): string => {
  const key = `mnt_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
  apiKeys.set(key, { id: userId, tier });
  logger.info({ userId, tier }, 'Generated new API key');
  return key;
};

// Utility function to revoke API keys
export const revokeApiKey = (key: string): boolean => {
  return apiKeys.delete(key);
};