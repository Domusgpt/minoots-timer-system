import express, { Application, Request, Response, NextFunction } from 'express';
import { registerTimerRoutes } from './routes/timerRoutes';
import { TimerService } from './services/timerService';
import { createKernelGateway } from './services/kernelGateway';
import { Authenticator } from './policy/authenticator';
import { QuotaManager } from './policy/quotaManager';
import { logger } from './telemetry/logger';
import { requestLogger, traceHeaderMiddleware } from './telemetry/middleware';

export interface ServerDependencies {
  timerService?: TimerService;
  authenticator?: Authenticator;
}

export const createServer = (dependencies: ServerDependencies = {}): Application => {
  const app = express();

  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use(traceHeaderMiddleware);

  const timerService =
    dependencies.timerService ?? new TimerService(createKernelGateway(), new QuotaManager());
  const authenticator = dependencies.authenticator ?? new Authenticator();

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'minoots-control-plane' });
  });

  registerTimerRoutes(app, timerService, authenticator);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error in control plane');
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
};
