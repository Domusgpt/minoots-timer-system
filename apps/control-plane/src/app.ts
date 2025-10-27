import express, { Application, Request, Response, NextFunction } from 'express';
import { registerTimerRoutes } from './routes/timerRoutes';
import { TimerService } from './services/timerService';
import { createKernelGateway, KernelGateway } from './services/kernelGateway';
import { logger } from './telemetry/logger';
import { requestLogger, traceHeaderMiddleware } from './telemetry/middleware';
import { PolicyEngine } from './policy/policyEngine';
import { QuotaMonitor } from './policy/quotaMonitor';
import { createAuthorizationMiddleware } from './middleware/authz';
import { createTimerRepository } from './store/createTimerRepository';
import { TimerRepository } from './store/timerRepository';

export interface ServerDependencies {
  policyEngine?: PolicyEngine;
  quotaMonitor?: QuotaMonitor;
  kernelGateway?: KernelGateway;
  timerRepository?: TimerRepository;
  timerService?: TimerService;
}

export const createServer = (deps: ServerDependencies = {}): Application => {
  const app = express();

  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use(traceHeaderMiddleware);

  const policyEngine = deps.policyEngine ?? new PolicyEngine();
  const quotaMonitor = deps.quotaMonitor ?? new QuotaMonitor();
  const kernelGateway = deps.kernelGateway ?? createKernelGateway({ signingSecret: policyEngine.signingSecret });
  const timerRepository = deps.timerRepository ?? createTimerRepository();
  const timerService = deps.timerService ?? new TimerService(kernelGateway, timerRepository, policyEngine);
  const authorization = createAuthorizationMiddleware({ policyEngine, quotaMonitor });

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'minoots-control-plane' });
  });

  registerTimerRoutes(app, timerService, authorization);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error in control plane');
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
};
