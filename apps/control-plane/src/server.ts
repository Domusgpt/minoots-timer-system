import { createServer } from './app';
import { logger } from './telemetry/logger';
import { closePostgresPool } from './store/postgresPool';
import { initTelemetry, shutdownTelemetry } from './telemetry/otel';
import { PolicyEngine } from './policy/policyEngine';
import { QuotaMonitor } from './policy/quotaMonitor';
import { createKernelGateway } from './services/kernelGateway';
import { createTimerRepository } from './store/createTimerRepository';
import { TimerService } from './services/timerService';
import { startGrpcServer } from './grpcServer';

const port = parseInt(process.env.PORT ?? '4000', 10);

const start = async () => {
  try {
    await initTelemetry();
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize OpenTelemetry, continuing without exporter');
  }

  const policyEngine = new PolicyEngine();
  const quotaMonitor = new QuotaMonitor();
  const kernelGateway = createKernelGateway({ signingSecret: policyEngine.signingSecret });
  const timerRepository = createTimerRepository();
  const timerService = new TimerService(kernelGateway, timerRepository, policyEngine);

  const app = createServer({ policyEngine, quotaMonitor, kernelGateway, timerRepository, timerService });
  const server = app.listen(port, () => {
    logger.info({ port }, 'MINOOTS control plane listening');
  });

  const grpcServer = await startGrpcServer({
    timerService,
    policyEngine,
    quotaMonitor,
    kernelGateway,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down control plane');
    server.close(() => {
      logger.info('HTTP server closed');
    });
    await new Promise<void>((resolve) => {
      grpcServer.tryShutdown((error) => {
        if (error) {
          logger.error({ error }, 'Error shutting down gRPC server, forcing close');
          grpcServer.forceShutdown();
        }
        resolve();
      });
    });
    await closePostgresPool().catch((error) => {
      logger.error({ error }, 'Failed to close Postgres pool cleanly');
    });
    await shutdownTelemetry().catch((error) => {
      logger.error({ error }, 'Failed to shutdown telemetry');
    });
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

start().catch((error) => {
  logger.error({ error }, 'Failed to start control plane');
  process.exit(1);
});
