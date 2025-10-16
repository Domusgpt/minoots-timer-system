import { randomUUID } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';

import { PolicyEngine, PolicyError } from '../policy/policyEngine';
import { QuotaExceededError, QuotaMonitor } from '../policy/quotaMonitor';
import { AuthContext, Permission } from '../types/auth';
import { logger } from '../telemetry/logger';

const TRACE_HEADER = 'x-trace-id';
const API_KEY_HEADER = 'x-api-key';
const TENANT_HEADER = 'x-tenant-id';

export type AuthorizationDependencies = {
  policyEngine: PolicyEngine;
  quotaMonitor: QuotaMonitor;
};

export type AuthorizationMiddlewareFactory = (
  permission: Permission,
) => (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

export const createAuthorizationMiddleware = ({
  policyEngine,
  quotaMonitor,
}: AuthorizationDependencies): AuthorizationMiddlewareFactory => {
  return (permission: Permission) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = extractTenant(req);
      const apiKey = (req.headers[API_KEY_HEADER] as string | undefined) ?? extractBearer(req);
      const requestId = req.headers['x-request-id'] as string | undefined;
      const context = policyEngine.authorize({
        apiKey,
        bearerToken: apiKey,
        tenantId,
        requestId: requestId ?? randomUUID(),
        traceId: req.headers[TRACE_HEADER] as string | undefined,
      });
      policyEngine.ensurePermission(context, permission);
      attachContext(req, context);
      if (permission === 'timers:create') {
        quotaMonitor.enforceScheduleQuota(context);
      }
      if (permission === 'timers:cancel') {
        quotaMonitor.enforceCancelQuota(context);
      }
      next();
    } catch (error) {
      handleAuthError(error, res);
    }
  };
};

const extractTenant = (req: Request): string => {
  const tenant = (req.headers[TENANT_HEADER] as string | undefined) ?? (req.query.tenantId as string | undefined);
  if (!tenant) {
    throw new PolicyError('Tenant header is required');
  }
  return tenant;
};

const extractBearer = (req: Request): string | undefined => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return undefined;
  }
  return authHeader;
};

const attachContext = (req: Request, context: AuthContext) => {
  (req as any).authContext = context;
};

const handleAuthError = (error: unknown, res: Response) => {
  if (error instanceof PolicyError) {
    res.status(403).json({ message: error.message });
    return;
  }
  if (error instanceof QuotaExceededError) {
    res.status(429).json({ message: error.message });
    return;
  }
  logger.error({ error }, 'Authorization middleware failure');
  res.status(500).json({ message: 'Authorization failure' });
};

export const getAuthContext = (req: Request): AuthContext => {
  const context = (req as any).authContext as AuthContext | undefined;
  if (!context) {
    throw new PolicyError('Request is missing authorization context');
  }
  return context;
};
