import express, { Application, Request, Response, NextFunction } from 'express';
import { registerTimerRoutes } from './routes/timerRoutes';
import { TimerService } from './services/timerService';
import { GrpcKernelGateway } from './services/grpcKernelGateway';
import { KernelGateway, NoopKernelGateway } from './services/kernelGateway';
import { logger } from './telemetry/logger';

export const createServer = (): Application => {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  let kernelGateway: KernelGateway;
  try {
    kernelGateway = new GrpcKernelGateway();
  } catch (error) {
    logger.error({ error }, 'Failed to initialize gRPC kernel gateway, falling back to noop gateway');
    kernelGateway = new NoopKernelGateway();
  }

  const timerService = new TimerService(kernelGateway);

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
