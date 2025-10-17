import { WebSocketServer } from 'ws';

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

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    if (!request.url || !request.url.startsWith('/timers/ws')) {
      socket.destroy();
      return;
    }

    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const tenantId = url.searchParams.get('tenantId');
      const topicParams = url.searchParams.getAll('topic');
      const commaTopics = url.searchParams.get('topics');
      const topics =
        topicParams.length > 0
          ? topicParams
          : commaTopics
              ?.split(',')
              .map((value) => value.trim())
              .filter((value) => value.length > 0) ?? [];

      const context = await authenticator.authenticateHeaders(request.headers);
      if (!context) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      if (!tenantId || tenantId !== context.tenantId) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const subscription = timerService.subscribeEvents(
          context,
          { tenantId, topics },
          {
            onEvent: (envelope) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'event', payload: envelope }));
              }
            },
            onError: (error) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: error.message }));
              }
            },
            onClose: () => {
              if (ws.readyState === ws.OPEN) {
                ws.close();
              }
            },
          },
        );

        ws.on('close', () => {
          subscription.close();
        });

        ws.on('message', (raw) => {
          logger.debug({ message: raw.toString() }, 'Timer stream client message');
        });

        ws.send(
          JSON.stringify({ type: 'ready', tenantId, topics }),
        );
      });
    } catch (error) {
      logger.error({ error }, 'Failed to upgrade WebSocket connection');
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
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
    wss.clients.forEach((client) => client.terminate());
    wss.close();
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
