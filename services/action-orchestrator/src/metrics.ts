import http from 'node:http';

import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import { logger } from './logger';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const actionAttempts = new Counter({
  name: 'minoots_action_attempt_total',
  help: 'Number of action execution attempts',
  labelNames: ['action_kind', 'tenant_id'],
  registers: [registry],
});

export const actionFailures = new Counter({
  name: 'minoots_action_failure_total',
  help: 'Number of action execution failures',
  labelNames: ['action_kind', 'tenant_id', 'reason'],
  registers: [registry],
});

export const actionLatency = new Histogram({
  name: 'minoots_action_duration_seconds',
  help: 'Action execution latency in seconds',
  labelNames: ['action_kind', 'tenant_id'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export interface MetricsServerHandle {
  server: http.Server;
  close: () => Promise<void>;
}

export const startMetricsServer = (port: number): MetricsServerHandle => {
  const server = http.createServer(async (req, res) => {
    if (!req.url || req.url !== '/metrics') {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const metrics = await registry.metrics();
      res.setHeader('Content-Type', registry.contentType);
      res.writeHead(200);
      res.end(metrics);
    } catch (error) {
      logger.error({ error }, 'Failed to collect metrics');
      res.writeHead(500);
      res.end('metrics collection failed');
    }
  });

  server.listen(port, () => {
    logger.info({ port }, 'Metrics server listening');
  });

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }).catch((error) => {
      logger.warn({ error }, 'Failed to close metrics server gracefully');
    });
    closed = true;
  };

  return { server, close };
};
