import http from 'node:http';

import client, { Counter, Histogram, Registry } from 'prom-client';

const registry = new Registry();
client.collectDefaultMetrics({ register: registry });

export const actionDispatchCounter = new Counter({
  name: 'minoots_action_dispatch_total',
  help: 'Total number of action dispatch attempts grouped by result',
  labelNames: ['action_kind', 'result'] as const,
  registers: [registry],
});

export const actionRetryCounter = new Counter({
  name: 'minoots_action_retry_total',
  help: 'Total number of action retries triggered by failures',
  labelNames: ['action_kind'] as const,
  registers: [registry],
});

export const actionDurationHistogram = new Histogram({
  name: 'minoots_action_dispatch_duration_seconds',
  help: 'Latency of executing timer actions',
  labelNames: ['action_kind'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const startMetricsServer = (port: number): http.Server => {
  const server = http.createServer(async (_req, res) => {
    if (_req.url === '/metrics') {
      const payload = await registry.metrics();
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Metrics server listening on :${port}`);
  });
  return server;
};
