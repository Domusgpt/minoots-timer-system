import { Response, NextFunction } from 'express';

import { logger } from '../telemetry/logger';
import { AuthenticatedRequest, Role } from './types';

export const requireRole = (role: Role) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const context = req.authContext;
    if (!context) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    if (!context.roles.includes(role) && !context.roles.includes('tenant.admin')) {
      logger.warn({ principalId: context.principalId, required: role }, 'Authorization failure');
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    next();
  };
};

export const ensureTenantMatch = (tenantId: string | undefined, req: AuthenticatedRequest): boolean => {
  const context = req.authContext;
  if (!context) {
    return false;
  }
  if (tenantId && tenantId !== context.tenantId) {
    return false;
  }
  return true;
};
