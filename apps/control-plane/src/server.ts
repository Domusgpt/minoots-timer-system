import { createServer } from './app';
import { logger } from './telemetry/logger';
import { closePostgresPool } from './store/postgresPool';
import { initTelemetry, shutdownTelemetry } from './telemetry/otel';
import { startGrpcGateway } from './grpc/server';
import { Authenticator } from './policy/authenticator';
import { createKernelGateway } from './services/kernelGateway';
import { TimerService } from './services/timerService';
import { QuotaManager } from './policy/quotaManager';

const port = parseInt(process.env.PORT ?? '4000', 10);

const start = async () => {
  try {
    await initTelemetry();
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize OpenTelemetry, continuing without exporter');
  }

  const quotaManager = new QuotaManager();
  const kernelGateway = createKernelGateway();
  const timerService = new TimerService(kernelGateway, quotaManager);
  const authenticator = new Authenticator();

  const app = createServer({ timerService, authenticator });
  const server = app.listen(port, () => {
    logger.info({ port }, 'MINOOTS control plane listening');
  });
  const grpcAddress = process.env.CONTROL_PLANE_GRPC_ADDR || '0.0.0.0:4001';
  const grpcGateway = await startGrpcGateway(timerService, authenticator, grpcAddress);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down control plane');
    server.close(() => {
      logger.info('HTTP server closed');
    });
    try {
      await grpcGateway.shutdown();
    } catch (error) {
      logger.error({ error }, 'Graceful gRPC shutdown failed; forcing close');
      grpcGateway.forceShutdown();
    }
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
