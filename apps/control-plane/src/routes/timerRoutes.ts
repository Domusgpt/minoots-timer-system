import express, { Application, Request, Response } from 'express';
import { ZodError } from 'zod';
import { TimerService } from '../services/timerService';
import { timerCancelSchema, timerCreateSchema, TimerRecord } from '../types/timer';
import { logger } from '../telemetry/logger';
import { AuthorizationMiddlewareFactory, getAuthContext } from '../middleware/authz';
import { QuotaExceededError } from '../policy/quotaMonitor';
import { PolicyError } from '../policy/policyEngine';

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
});

const tenantFromQuery = (req: Request): string => {
  const candidate = (req.query.tenantId as string | undefined) ?? (req.headers['x-tenant-id'] as string | undefined);
  if (!candidate) {
    throw new Error('tenantId must be provided via query parameter or x-tenant-id header');
  }
  return candidate;
};

const handleError = (err: unknown, res: Response) => {
  if (err instanceof ZodError) {
    res.status(400).json({ message: 'Validation failed', details: err.issues });
    return;
  }
  if (err instanceof QuotaExceededError) {
    res.status(429).json({ message: err.message });
    return;
  }
  if (err instanceof PolicyError) {
    res.status(403).json({ message: err.message });
    return;
  }

  logger.error({ err }, 'Timer route error');
  res.status(500).json({ message: 'Unexpected error' });
};

export const registerTimerRoutes = (
  app: Application,
  timerService: TimerService,
  authorization: AuthorizationMiddlewareFactory,
) => {
  const router = express.Router();

  router.post('/', authorization('timers:create'), async (req, res) => {
    try {
      const context = getAuthContext(req);
      const payload = timerCreateSchema.parse(req.body);
      if (context.tenantId !== payload.tenantId) {
        res.status(403).json({ message: 'tenantId mismatch with credential' });
        return;
      }
      const timer = await timerService.createTimer(context, payload);
      res.status(201).json(toResponse(timer));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/', authorization('timers:read'), async (req, res) => {
    try {
      const context = getAuthContext(req);
      const tenantId = tenantFromQuery(req);
      if (tenantId !== context.tenantId && tenantId !== '__all__') {
        res.status(403).json({ message: 'Cross-tenant access is not permitted' });
        return;
      }
      const timers = await timerService.listTimers(context, tenantId === '__all__' ? context.tenantId : tenantId);
      res.json(timers.map(toResponse));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/:id', authorization('timers:read'), async (req, res) => {
    try {
      const context = getAuthContext(req);
      const tenantId = context.tenantId;
      const timer = await timerService.getTimer(context, tenantId, req.params.id);
      if (!timer) {
        res.status(404).json({ message: 'Timer not found' });
        return;
      }
      res.json(toResponse(timer));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/:id/cancel', authorization('timers:cancel'), async (req, res) => {
    try {
      const context = getAuthContext(req);
      const tenantId = context.tenantId;
      const payload = timerCancelSchema.parse(req.body);
      if (payload.tenantId !== tenantId) {
        res.status(403).json({ message: 'tenantId mismatch with credential' });
        return;
      }
      const timer = await timerService.cancelTimer(context, tenantId, req.params.id, payload);
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
