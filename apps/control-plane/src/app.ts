import express, { Application, Request, Response, NextFunction } from 'express';
import { registerTimerRoutes } from './routes/timerRoutes';
import { TimerService } from './services/timerService';
import { InMemoryTimerRepository } from './store/inMemoryTimerRepository';
import { logger } from './telemetry/logger';
import { GrpcKernelGateway } from './services/grpcKernelGateway';
import { KernelGateway, NoopKernelGateway } from './services/kernelGateway';
import { authenticateUser, rateLimitMiddleware } from './middleware/auth';
import { FileTimerRepository } from './store/fileTimerRepository';

export const createServer = (): Application => {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Add authentication and rate limiting
  app.use(authenticateUser);
  app.use(rateLimitMiddleware);

  const timerRepository = process.env.TIMER_STORE_PATH
    ? new FileTimerRepository(process.env.TIMER_STORE_PATH)
    : new InMemoryTimerRepository();

  if (!process.env.TIMER_STORE_PATH) {
    logger.warn('Using in-memory timer repository (persistence disabled)');
  } else {
    logger.info({ path: process.env.TIMER_STORE_PATH }, 'Using file-backed timer repository');
  }
  const kernelGateway: KernelGateway = process.env.KERNEL_GRPC_ADDRESS
    ? new GrpcKernelGateway(
        process.env.KERNEL_GRPC_ADDRESS,
        process.env.KERNEL_PROTO_PATH,
      )
    : new NoopKernelGateway();

  if (!process.env.KERNEL_GRPC_ADDRESS) {
    logger.warn('Using Noop kernel gateway (horology kernel not configured)');
  } else {
    logger.info(
      { address: process.env.KERNEL_GRPC_ADDRESS },
      'Using gRPC kernel gateway',
    );
  }

  const timerService = new TimerService(timerRepository, kernelGateway);

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
