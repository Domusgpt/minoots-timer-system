import express, { Application, Request, Response, NextFunction } from 'express';
import { registerTimerRoutes } from './routes/timerRoutes';
import { registerBillingRoutes } from './routes/billingRoutes';
import { registerApiKeyRoutes } from './routes/apiKeyRoutes';
import { TimerService } from './services/timerService';
import { createKernelGateway } from './services/kernelGateway';
import { logger } from './telemetry/logger';
import { FirebaseAuthMiddleware } from './middleware/auth';
import { createUsageTracker } from './services/usageTracker';
import { createApiKeyService } from './services/apiKeyService';
import { createStripeService } from './services/stripe';
import { controlPlaneConfig } from './config';

export const createServer = (): Application => {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  const usageTracker = createUsageTracker(controlPlaneConfig.usageTrackerBackend);
  const apiKeyService = createApiKeyService(controlPlaneConfig.apiKeyBackend);
  const stripeService = createStripeService({ enabled: controlPlaneConfig.billingEnabled });
  const kernelGateway = createKernelGateway();
  const timerService = new TimerService(kernelGateway, usageTracker);
  const authMiddleware = new FirebaseAuthMiddleware({
    apiKeyService,
    allowAnonymous: controlPlaneConfig.authMode === 'anonymous',
    firebaseEnabled: controlPlaneConfig.authMode === 'firebase',
    anonymousUser: controlPlaneConfig.anonymousUser,
    freePaths: controlPlaneConfig.publicRoutes,
  });

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'minoots-control-plane' });
  });

  if (controlPlaneConfig.authMode === 'firebase') {
    app.use(authMiddleware.handle);
  } else {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (!req.auth) {
        req.auth = { user: controlPlaneConfig.anonymousUser, method: 'anonymous' };
      }
      next();
    });
  }

  registerTimerRoutes(app, timerService);
  registerApiKeyRoutes(app, apiKeyService);
  registerBillingRoutes(app, stripeService);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error in control plane');
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
};
