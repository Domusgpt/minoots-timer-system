import express, { Application, Request, Response, NextFunction } from 'express';
import { registerTimerRoutes } from './routes/timerRoutes';
import { TimerService } from './services/timerService';
import { InMemoryTimerRepository } from './store/inMemoryTimerRepository';
import { logger } from './telemetry/logger';

export const createServer = (): Application => {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  const timerRepository = new InMemoryTimerRepository();
  const timerService = new TimerService(timerRepository);

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'minoots-control-plane' });
  });

  registerTimerRoutes(app, timerService);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error in control plane');
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
};
