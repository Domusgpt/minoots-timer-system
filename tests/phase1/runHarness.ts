import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import net from 'node:net';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { AddressInfo } from 'node:net';
import { config as loadEnv } from 'dotenv';

import { createServer, ServerDependencies } from '../../apps/control-plane/src/app';
import {
  InMemoryKernelGateway,
  KernelNotLeaderError,
} from '../../apps/control-plane/src/services/kernelGateway';
import { TimerService } from '../../apps/control-plane/src/services/timerService';
import { Authenticator } from '../../apps/control-plane/src/policy/authenticator';
import { QuotaManager } from '../../apps/control-plane/src/policy/quotaManager';
import { startGrpcGateway } from '../../apps/control-plane/src/grpc/server';
import { ensurePolicySeeds, loadPolicySeeds } from '../../apps/control-plane/src/policy/seeds';
import { getPostgresPool, closePostgresPool } from '../../apps/control-plane/src/store/postgresPool';
import { getQuotaForTenant } from '../../apps/control-plane/src/store/tenantRepository';

const log = (message: string, meta?: Record<string, unknown>) => {
  console.log(`[phase1] ${message}`, meta ?? '');
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type KernelClientConstructor = new (address: string, credentials: grpc.ChannelCredentials) => grpc.Client & {
  ScheduleTimer: grpc.handleUnaryCall<any, any>;
};

const loadKernelClientCtor = (() => {
  let ctor: KernelClientConstructor | null = null;
  return () => {
    if (ctor) {
      return ctor;
    }
    const protoPath = path.resolve(__dirname, '../../proto/timer.proto');
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const clientCtor = descriptor?.minoots?.timer?.v1?.HorologyKernel;
    if (!clientCtor) {
      throw new Error('Failed to load HorologyKernel client constructor for gRPC checks');
    }
    ctor = clientCtor as KernelClientConstructor;
    return ctor;
  };
})();

const envPath = (() => {
  const primary = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(primary)) {
    return primary;
  }
  const fallback = path.resolve(__dirname, '../../.env.example');
  if (fs.existsSync(fallback)) {
    return fallback;
  }
  return undefined;
})();

if (envPath) {
  loadEnv({ path: envPath });
  log('Loaded environment configuration', { envPath });
} else {
  log('No environment file found; relying on existing process env');
}

const seeds = loadPolicySeeds();
if (seeds.length === 0) {
  throw new Error('No policy seeds configured for integration harness');
}

const { tenantId, apiKey } = seeds[0];

const databaseUrl = process.env.KERNEL_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL or KERNEL_DATABASE_URL must be set for the Phase 1 harness');
}

interface KernelProcessHandle {
  nodeId: string;
  grpcPort: number;
  metricsPort: number;
  process: ChildProcessWithoutNullStreams;
}

const waitForPort = async (port: number, host = '127.0.0.1', timeoutMs = 15000) => {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', (error) => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port} to accept connections: ${error}`));
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
};

const assertKernelMetrics = async (
  metricsPort: number,
  options: { requireCoordinatorMetric?: boolean } = {},
) => {
  const url = `http://127.0.0.1:${metricsPort}/metrics`;
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.text();
        const hasCoordinator = body.includes('kernel_coordinator');
        if (!options.requireCoordinatorMetric || hasCoordinator) {
          log('Kernel metrics endpoint reachable', {
            metricsPort,
            coordinatorMetric: hasCoordinator,
          });
          return;
        }
        log('Kernel metrics response missing coordinator counters; retrying', {
          metricsPort,
        });
      }
    } catch (error) {
      log('Metrics probe failed; retrying', { metricsPort, error: (error as Error).message });
    }
    await delay(300);
  }
  throw new Error(`Kernel metrics endpoint ${url} did not become ready`);
};

const startKernelProcess = async (
  nodeId: string,
  grpcPort: number,
  metricsPort: number,
): Promise<KernelProcessHandle> => {
  const child = spawn(
    'cargo',
    ['run', '--quiet', '--manifest-path', 'services/horology-kernel/Cargo.toml', '--bin', 'kernel'],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        KERNEL_DATABASE_URL: databaseUrl,
        KERNEL_STORE: 'postgres',
        KERNEL_NODE_ID: nodeId,
        KERNEL_GRPC_ADDR: `127.0.0.1:${grpcPort}`,
        KERNEL_METRICS_ADDR: `127.0.0.1:${metricsPort}`,
        RUST_LOG: process.env.RUST_LOG ?? 'debug',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim();
    if (message) {
      log(`kernel(${nodeId}) stdout`, { message });
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim();
    if (message) {
      log(`kernel(${nodeId}) stderr`, { message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Kernel process ${nodeId} exited during startup (code=${code} signal=${signal})`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(new Error(`Kernel process ${nodeId} failed to spawn: ${error.message}`));
    };
    const cleanup = () => {
      child.off('exit', handleExit);
      child.off('error', handleError);
    };
    child.once('exit', handleExit);
    child.once('error', handleError);
    waitForPort(grpcPort)
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
  log('Kernel gRPC endpoint ready', { nodeId, grpcPort });
  await assertKernelMetrics(metricsPort);
  return { nodeId, grpcPort, metricsPort, process: child };
};

const stopKernelProcess = async (handle: KernelProcessHandle) => {
  if (!handle || handle.process.exitCode !== null) {
    return;
  }
  const exit = new Promise<void>((resolve) => {
    handle.process.once('exit', () => resolve());
  });
  handle.process.kill('SIGINT');
  await Promise.race([
    exit,
    (async () => {
      await delay(5000);
      if (handle.process.exitCode === null) {
        handle.process.kill('SIGKILL');
      }
    })(),
  ]);
  await exit;
  log('Kernel process stopped', { nodeId: handle.nodeId });
};

type KernelScheduleResult = 'ok' | 'not-leader' | 'unavailable';

const tryScheduleAgainstKernel = async (
  address: string,
  label: string,
): Promise<KernelScheduleResult> => {
  const KernelClient = loadKernelClientCtor();
  const client = new KernelClient(address, grpc.credentials.createInsecure());
  const metadata = new grpc.Metadata();
  metadata.set('x-tenant-id', tenantId);
  metadata.set('x-api-key', apiKey);

  try {
    return await new Promise<KernelScheduleResult>((resolve, reject) => {
      client.ScheduleTimer(
        {
          tenantId,
          requestedBy: 'phase1-cluster-check',
          name: label,
          durationMs: 1500,
        },
        metadata,
        (error: grpc.ServiceError | null) => {
          if (error) {
            if (error.code === grpc.status.FAILED_PRECONDITION) {
              resolve('not-leader');
              return;
            }
            if (error.code === grpc.status.UNAVAILABLE || error.code === grpc.status.CANCELLED) {
              resolve('unavailable');
              return;
            }
            reject(error);
            return;
          }
          resolve('ok');
        },
      );
    });
  } finally {
    client.close();
  }
};

const waitForLeadership = async (kernel: KernelProcessHandle) => {
  const address = `127.0.0.1:${kernel.grpcPort}`;
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const result = await tryScheduleAgainstKernel(address, `failover-${Date.now()}`);
    if (result === 'ok') {
      log('Follower assumed leadership', { nodeId: kernel.nodeId });
      return;
    }
    log('Waiting for follower to assume leadership', { nodeId: kernel.nodeId, result });
    await delay(500);
  }
  throw new Error(`Kernel ${kernel.nodeId} did not assume leadership within timeout`);
};

const waitForLeaderReady = async (kernel: KernelProcessHandle) => {
  const address = `127.0.0.1:${kernel.grpcPort}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await tryScheduleAgainstKernel(address, `leader-probe-${Date.now()}`);
    if (result === 'ok') {
      return;
    }
    await delay(300);
  }
  throw new Error(`Kernel ${kernel.nodeId} did not become leader within timeout`);
};

const waitForFollowerState = async (kernel: KernelProcessHandle) => {
  const address = `127.0.0.1:${kernel.grpcPort}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await tryScheduleAgainstKernel(address, `follower-probe-${Date.now()}`);
    if (result === 'not-leader') {
      return;
    }
    if (result === 'ok') {
      throw new Error(`Kernel ${kernel.nodeId} unexpectedly became leader`);
    }
    await delay(300);
  }
  throw new Error(`Kernel ${kernel.nodeId} did not report follower state`);
};

const runKernelClusterChecks = async () => {
  const kernels: KernelProcessHandle[] = [];
  try {
    const leaderHandle = await startKernelProcess('kernel-a', 52051, 9610);
    kernels.push(leaderHandle);
    await waitForLeaderReady(leaderHandle);

    const followerHandle = await startKernelProcess('kernel-b', 52052, 9611);
    kernels.push(followerHandle);
    await waitForFollowerState(followerHandle);

    log('Cluster leadership determined', {
      leader: leaderHandle.nodeId,
      followers: [followerHandle.nodeId],
    });

    log('Terminating leader kernel to trigger failover', { leader: leaderHandle.nodeId });
    await stopKernelProcess(leaderHandle);

    await waitForLeadership(followerHandle);

    await assertKernelMetrics(followerHandle.metricsPort, { requireCoordinatorMetric: true });
    log('Failover metrics validated', { follower: followerHandle.nodeId });
  } finally {
    await Promise.all(
      kernels.map(async (kernel) => {
        if (kernel.process.exitCode === null) {
          try {
            await stopKernelProcess(kernel);
          } catch (error) {
            log('Failed to stop kernel process cleanly', { nodeId: kernel.nodeId, error });
          }
        }
      }),
    );
  }
};

class FollowerKernelGateway extends InMemoryKernelGateway {
  async schedule(): Promise<never> {
    throw new KernelNotLeaderError('integration follower node', 250);
  }
}

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  return { response, data } as const;
};

const runHttpChecks = async (server: http.Server, port: number, burstLimit: number) => {
  const baseUrl = `http://127.0.0.1:${port}`;
  const unauthenticated = await fetch(`${baseUrl}/timers`);
  if (unauthenticated.status !== 401) {
    throw new Error(`Expected 401 for unauthenticated request, received ${unauthenticated.status}`);
  }

  const schedulePayload = {
    tenantId,
    requestedBy: 'integration-test',
    name: 'harness-http',
    duration: 1000,
  };
  const { response: scheduleResponse, data: scheduleData } = await fetchJson(`${baseUrl}/timers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(schedulePayload),
  });
  if (scheduleResponse.status !== 201) {
    throw new Error(`Expected 201 from POST /timers, got ${scheduleResponse.status}`);
  }

  log('Scheduled timer via HTTP', { id: scheduleData.id });

  const list = await fetchJson(`${baseUrl}/timers`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!Array.isArray(list.data) || list.data.length === 0) {
    throw new Error('Expected list of timers for authenticated tenant');
  }
  log('Retrieved timers via HTTP', { count: list.data.length });

  for (let i = 0; i < burstLimit - 1; i += 1) {
    const payload = {
      tenantId,
      requestedBy: `quota-test-${i}`,
      name: `quota-${i}`,
      duration: 1000,
    };
    const { response } = await fetchJson(`${baseUrl}/timers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });
    if (response.status !== 201) {
      throw new Error(`Expected 201 for quota setup request, got ${response.status}`);
    }
  }

  const { response: overLimit } = await fetchJson(`${baseUrl}/timers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      tenantId,
      requestedBy: 'integration-over-limit',
      name: 'quota-over-limit',
      duration: 1000,
    }),
  });

  if (overLimit.status !== 429) {
    throw new Error(`Expected 429 when exceeding burst quota, received ${overLimit.status}`);
  }

  log('Quota enforcement validated via HTTP');
};

const runFollowerHttpCheck = async (authenticator: Authenticator): Promise<void> => {
  const followerTimerService = new TimerService(
    new FollowerKernelGateway(),
    { enforceScheduleQuota: async () => {} } as unknown as QuotaManager,
  );
  const followerDeps: ServerDependencies = { timerService: followerTimerService, authenticator };
  const followerApp = createServer(followerDeps);
  const followerServer = followerApp.listen(0);
  const followerPort = (followerServer.address() as AddressInfo).port;

  try {
    const payload = {
      tenantId,
      requestedBy: 'follower-test',
      name: 'follower-simulation',
      duration: 1000,
    };
    const { response } = await fetchJson(`http://127.0.0.1:${followerPort}/timers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (response.status !== 503) {
      throw new Error(`Expected 503 from follower timer creation, received ${response.status}`);
    }

    const retryAfter = response.headers.get('retry-after');
    if (!retryAfter) {
      throw new Error('Expected retry-after header from follower response');
    }

    log('Follower HTTP gateway returned expected 503 with retry hint', { retryAfter });
  } finally {
    followerServer.close();
  }
};

const runGrpcChecks = async (
  port: number,
): Promise<void> => {
  const KernelClient = loadKernelClientCtor();
  const client = new KernelClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const metadata = new grpc.Metadata();
  metadata.set('x-api-key', apiKey);
  metadata.set('x-tenant-id', tenantId);

  const schedule = () =>
    new Promise((resolve, reject) => {
      client.ScheduleTimer(
        {
          tenantId,
          requestedBy: 'grpc-test',
          name: 'harness-grpc',
          durationMs: 2000,
        },
        metadata,
        (error: unknown, response: unknown) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(response);
        },
      );
    });
  await schedule();
  log('Scheduled timer via gRPC');
  client.close();
};

const main = async () => {
  const pool = getPostgresPool();
  await ensurePolicySeeds(pool, seeds);
  await pool.query('TRUNCATE timer_records RESTART IDENTITY');
  await pool.query('TRUNCATE tenant_quota_usage RESTART IDENTITY');
  await pool.query('TRUNCATE timer_command_log RESTART IDENTITY');

  const authenticator = new Authenticator();
  const quotaManager = new QuotaManager(pool);
  const kernelGateway = new InMemoryKernelGateway();
  const timerService = new TimerService(kernelGateway, quotaManager as unknown as QuotaManager);

  const deps: ServerDependencies = { timerService, authenticator };
  const app = createServer(deps);
  const httpServer = app.listen(0);
  const httpPort = (httpServer.address() as AddressInfo).port;

  const grpcGateway = await startGrpcGateway(timerService, authenticator, `127.0.0.1:0`);
  const quota = await getQuotaForTenant(pool, tenantId);

  try {
    await runHttpChecks(httpServer, httpPort, quota.burstTimerLimit);
    await pool.query('TRUNCATE timer_records RESTART IDENTITY');
    await pool.query('TRUNCATE timer_command_log RESTART IDENTITY');
    await pool.query('TRUNCATE tenant_quota_usage RESTART IDENTITY');
    await runGrpcChecks(grpcGateway.port);
    await runFollowerHttpCheck(authenticator);
    await pool.query('TRUNCATE timer_records RESTART IDENTITY');
    await pool.query('TRUNCATE timer_command_log RESTART IDENTITY');
    await runKernelClusterChecks();
    await pool.query('TRUNCATE timer_records RESTART IDENTITY');
    await pool.query('TRUNCATE timer_command_log RESTART IDENTITY');
    log('HTTP, gRPC, follower, and kernel cluster checks completed');
  } finally {
    await grpcGateway.shutdown().catch((error: unknown) => {
      log('Graceful gRPC shutdown failed', { error });
      grpcGateway.forceShutdown();
    });
    httpServer.close();
    await closePostgresPool();
  }
};

main().catch((error) => {
  console.error('[phase1] integration harness failed', error);
  process.exit(1);
});
