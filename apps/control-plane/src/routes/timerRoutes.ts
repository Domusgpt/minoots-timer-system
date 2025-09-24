import express, { Application, Request, Response } from 'express';
import { ZodError } from 'zod';
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
});

const tenantFromQuery = (req: Request): string => {
  const candidate = (req.query.tenantId as string | undefined) ?? (req.headers['x-tenant-id'] as string | undefined);
  if (!candidate) {
    throw new Error('tenantId must be provided via query parameter or x-tenant-id header');
  }
  return candidate;
};

const tenantFromHeader = (req: Request): string => {
  const candidate = req.headers['x-tenant-id'] as string | undefined;
  if (!candidate) {
    throw new Error('x-tenant-id header is required');
  }
  return candidate;
};

const handleError = (err: unknown, res: Response) => {
  if (err instanceof ZodError) {
    res.status(400).json({ message: 'Validation failed', details: err.issues });
    return;
  }

  logger.error({ err }, 'Timer route error');
  res.status(500).json({ message: 'Unexpected error' });
};

export const registerTimerRoutes = (app: Application, timerService: TimerService) => {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const payload = timerCreateSchema.parse(req.body);
      const headerTenant = req.headers['x-tenant-id'] as string | undefined;
      if (headerTenant && headerTenant !== payload.tenantId) {
        res.status(400).json({ message: 'tenantId mismatch between header and payload' });
        return;
      }
      const timer = await timerService.createTimer(payload);
      res.status(201).json(toResponse(timer));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/', async (req, res) => {
    try {
      const tenantId = tenantFromQuery(req);
      const timers = await timerService.listTimers(tenantId);
      res.json(timers.map(toResponse));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const tenantId = tenantFromHeader(req);
      const timer = await timerService.getTimer(tenantId, req.params.id);
      if (!timer) {
        res.status(404).json({ message: 'Timer not found' });
        return;
      }
      res.json(toResponse(timer));
    } catch (err) {
      handleError(err, res);
    }
  });

  router.post('/:id/cancel', async (req, res) => {
    try {
      const tenantId = tenantFromHeader(req);
      const payload = timerCancelSchema.parse(req.body);
      if (payload.tenantId !== tenantId) {
        res.status(400).json({ message: 'tenantId mismatch between header and payload' });
        return;
      }
      const timer = await timerService.cancelTimer(tenantId, req.params.id, payload);
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
