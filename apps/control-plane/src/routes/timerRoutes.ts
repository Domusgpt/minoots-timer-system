import express, { Application, Response } from 'express';
import { ZodError } from 'zod';

import { Authenticator, authMiddleware } from '../policy/authenticator';
import { requireRole, ensureTenantMatch } from '../policy/authorization';
import { QuotaExceededError } from '../policy/quotaManager';
import { AuthenticatedRequest } from '../policy/types';
import { KernelNotLeaderError } from '../services/kernelGateway';
import { TimerService } from '../services/timerService';
import { timerCancelSchema, timerCreateSchema, TimerRecord } from '../types/timer';
import { logger } from '../telemetry/logger';

const toResponse = (timer: TimerRecord) => ({
  id: timer.id,
  tenantId: timer.tenantId,
  name: timer.name,
  status: timer.status,
  durationMs: timer.durationMs,
  createdAt: timer.createdAt,
  fireAt: timer.fireAt,
  requestedBy: timer.requestedBy,
  metadata: timer.metadata ?? {},
  labels: timer.labels ?? {},
  actionBundle: timer.actionBundle,
  agentBinding: timer.agentBinding,
  firedAt: timer.firedAt,
  cancelledAt: timer.cancelledAt,
  cancelReason: timer.cancelReason,
  cancelledBy: timer.cancelledBy,
  settledAt: timer.settledAt,
  failureReason: timer.failureReason,
  temporalGraph: timer.temporalGraph,
  graphRootId: timer.graphRootId,
  graphNodeId: timer.graphNodeId,
  jitterPolicy: timer.jitterPolicy,
});

const tenantFromQuery = (req: AuthenticatedRequest): string => {
  const queryTenant = req.query.tenantId as string | undefined;
  if (!queryTenant) {
    return req.authContext!.tenantId;
  }
  if (!ensureTenantMatch(queryTenant, req)) {
    throw new Error('Tenant mismatch with authenticated principal');
  }
  return queryTenant;
};

const tenantFromHeader = (req: AuthenticatedRequest): string => {
  const headerTenant = req.headers['x-tenant-id'] as string | undefined;
  const contextTenant = req.authContext?.tenantId;
  const resolved = headerTenant ?? contextTenant;
  if (!resolved) {
    throw new Error('x-tenant-id header is required');
  }
  if (!ensureTenantMatch(resolved, req)) {
    throw new Error('Tenant mismatch with authenticated principal');
  }
  return resolved;
};

const topicsFromRequest = (req: AuthenticatedRequest): string[] => {
  const topics = req.query.topic ?? req.query.topics;
  if (!topics) {
    return [];
  }
  if (Array.isArray(topics)) {
    return topics.map((value) => value.toString()).filter((value) => value.length > 0);
  }
  return topics
    .toString()
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const handleError = (err: unknown, res: Response) => {
  if (err instanceof ZodError) {
    res.status(400).json({ message: 'Validation failed', details: err.issues });
    return;
  }
  if (err instanceof QuotaExceededError) {
    res.status(429).json({ message: err.message, limitType: err.limitType });
    return;
  }
  if (err instanceof KernelNotLeaderError) {
    if (typeof err.retryAfterMs === 'number') {
      const seconds = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
      res.setHeader('Retry-After', seconds.toString());
    }
    res
      .status(503)
      .json({ message: err.message, retryAfterMs: err.retryAfterMs });
    return;
  }

  logger.error({ err }, 'Timer route error');
  res.status(500).json({ message: 'Unexpected error' });
};

export const registerTimerRoutes = (
  app: Application,
  timerService: TimerService,
  authenticator = new Authenticator(),
) => {
  const router = express.Router();

  router.use(authMiddleware(authenticator));

  router.get('/stream', requireRole('timer.read'), (req: AuthenticatedRequest, res) => {
    try {
      const context = req.authContext!;
      const tenantId = tenantFromQuery(req);
      if (tenantId !== context.tenantId) {
        res.status(403).json({ message: 'Authenticated principal cannot access requested tenant' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const flushable = res as Response & { flushHeaders?: () => void };
      flushable.flushHeaders?.();

      const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
      }, 15000);

      const subscription = timerService.subscribeEvents(
        context,
        { tenantId, topics: topicsFromRequest(req) },
        {
          onEvent: (envelope) => {
            res.write(`event: ${envelope.eventType}\n`);
            res.write(`data: ${JSON.stringify(envelope)}\n\n`);
          },
          onError: (error) => {
            res.write('event: error\n');
            res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
          },
          onClose: () => {
            res.end();
          },
        },
      );

      req.on('close', () => {
        clearInterval(keepAlive);
        subscription.close();
      });
    } catch (error) {
      handleError(error, res);
    }
  });

  router.post('/', requireRole('timer.write'), async (req: AuthenticatedRequest, res) => {
    try {
      const payload = timerCreateSchema.parse(req.body);
      const context = req.authContext!;
      if (!ensureTenantMatch(payload.tenantId, req)) {
        res.status(403).json({ message: 'Authenticated principal cannot access requested tenant' });
        return;
      }
      const timer = await timerService.createTimer(context, payload);
      res.status(201).json(toResponse(timer));
    } catch (err) {
      handleError(timerService.translateError(err), res);
    }
  });

  router.get('/', requireRole('timer.read'), async (req: AuthenticatedRequest, res) => {
    try {
      const context = req.authContext!;
      const tenantId = tenantFromQuery(req);
      if (tenantId !== context.tenantId) {
        res.status(403).json({ message: 'Authenticated principal cannot access requested tenant' });
        return;
      }
      const timers = await timerService.listTimers(context);
      res.json(timers.map(toResponse));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/:id', requireRole('timer.read'), async (req: AuthenticatedRequest, res) => {
    try {
      const context = req.authContext!;
      const tenantId = tenantFromHeader(req);
      if (tenantId !== context.tenantId) {
        res.status(403).json({ message: 'Authenticated principal cannot access requested tenant' });
        return;
      }
      const timer = await timerService.getTimer(context, req.params.id);
      if (!timer) {
        res.status(404).json({ message: 'Timer not found' });
        return;
      }
      res.json(toResponse(timer));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/:id/cancel', requireRole('timer.cancel'), async (req: AuthenticatedRequest, res) => {
    try {
      const context = req.authContext!;
      const tenantId = tenantFromHeader(req);
      const payload = timerCancelSchema.parse(req.body);
      if (payload.tenantId !== tenantId || tenantId !== context.tenantId) {
        res.status(403).json({ message: 'Authenticated principal cannot cancel timer for another tenant' });
        return;
      }
      const timer = await timerService.cancelTimer(context, req.params.id, payload);
      if (!timer) {
        res.status(404).json({ message: 'Timer not found' });
        return;
      }
      res.json(toResponse(timer));
    } catch (err) {
      handleError(err, res);
    }
  });

  app.use('/timers', router);
};
