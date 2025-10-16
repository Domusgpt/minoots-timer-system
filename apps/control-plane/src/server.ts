import { createServer } from './app';
import { logger } from './telemetry/logger';
import { closePostgresPool } from './store/postgresPool';
import { initTelemetry, shutdownTelemetry } from './telemetry/otel';

const port = parseInt(process.env.PORT ?? '4000', 10);

const start = async () => {
  try {
    await initTelemetry();
  } catch (error) {
    logger.warn({ error }, 'Failed to initialize OpenTelemetry, continuing without exporter');
  }

  const app = createServer();
  const server = app.listen(port, () => {
    logger.info({ port }, 'MINOOTS control plane listening');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down control plane');
    server.close(() => {
      logger.info('HTTP server closed');
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
