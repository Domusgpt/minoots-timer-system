import crypto from 'node:crypto';

import type { Metadata } from '@grpc/grpc-js';
import type { Request, Response, NextFunction } from 'express';

import { logger } from '../telemetry/logger';
import { getPostgresPool } from '../store/postgresPool';
import { findApiKeyByHash, updateApiKeyLastUsed, getQuotaForTenant } from '../store/tenantRepository';
import { AuthContext } from './types';

const hashApiKey = (apiKey: string): string => {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
};

const REGION_HEADER_CANDIDATES = ['x-minoots-region', 'x-region', 'x-home-region'];

const sanitizeRegionHint = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class Authenticator {
  constructor(private readonly headerName = 'x-api-key') {}

  async authenticateRequest(req: Request): Promise<AuthContext | null> {
    const apiKey = req.header(this.headerName);
    if (!apiKey) {
      return null;
    }
    const traceId = req.header('x-trace-id') ?? undefined;
    const regionHint = REGION_HEADER_CANDIDATES.map((header) => req.header(header))
      .map(sanitizeRegionHint)
      .find((value) => Boolean(value));
    return this.authenticate(apiKey, traceId, regionHint);
  }

  async authenticateMetadata(metadata: Metadata): Promise<AuthContext | null> {
    const apiKey = metadata.get(this.headerName).find((value) => typeof value === 'string');
    if (!apiKey || typeof apiKey !== 'string') {
      return null;
    }
    const traceId = metadata.get('x-trace-id').find((value) => typeof value === 'string');
    const regionHint = REGION_HEADER_CANDIDATES.map((header) =>
      metadata
        .get(header)
        .find((value) => typeof value === 'string') as string | undefined,
    )
      .map(sanitizeRegionHint)
      .find((value) => Boolean(value));
    return this.authenticate(apiKey, traceId as string | undefined, regionHint);
  }

  async middleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const context = await this.authenticateRequest(req);
      if (!context) {
        res.status(401).json({ message: 'API key required' });
        return;
      }
      req.authContext = context;
      next();
    } catch (error) {
      logger.error({ error }, 'Failed to authenticate request');
      res.status(500).json({ message: 'Authentication service unavailable' });
    }
  }

  private async authenticate(
    apiKey: string,
    traceId?: string,
    preferredRegion?: string,
  ): Promise<AuthContext | null> {
    const hash = hashApiKey(apiKey);
    const pool = getPostgresPool();
    const record = await findApiKeyByHash(pool, hash);
    if (!record || !record.active) {
      return null;
    }

    await updateApiKeyLastUsed(pool, record.id).catch((error) => {
      logger.warn({ error, apiKeyId: record.id }, 'Failed to update API key last used timestamp');
    });

    const quota = await getQuotaForTenant(pool, record.tenantId);

    const context: AuthContext = {
      tenantId: record.tenantId,
      principalId: record.id,
      roles: record.roles.length > 0 ? (record.roles as AuthContext['roles']) : ['timer.read'],
      quota: {
        dailyTimerLimit: quota.dailyTimerLimit,
        burstTimerLimit: quota.burstTimerLimit,
      },
      traceId,
      apiKeyId: record.id,
      preferredRegion: sanitizeRegionHint(preferredRegion),
    };

    return context;
  }
}

export const authMiddleware = (authenticator = new Authenticator()) => {
  return (req: Request, res: Response, next: NextFunction) => {
    authenticator.middleware(req, res, next);
  };
};

export const buildSignedHeaders = (context: AuthContext): Record<string, string> => {
  const signature = crypto
    .createHash('sha256')
    .update(`${context.principalId}:${context.tenantId}`)
    .digest('hex');
  return {
    'x-tenant-id': context.tenantId,
    'x-principal-id': context.principalId,
    'x-signature': signature,
    ...(context.traceId ? { 'x-trace-id': context.traceId } : {}),
  };
};
