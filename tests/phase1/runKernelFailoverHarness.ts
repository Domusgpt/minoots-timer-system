import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { config as loadEnv } from 'dotenv';

import { ensurePolicySeeds, loadPolicySeeds } from '../../apps/control-plane/src/policy/seeds';
import { getPostgresPool, closePostgresPool } from '../../apps/control-plane/src/store/postgresPool';

const log = (message: string, meta?: Record<string, unknown>) => {
  console.log(`[phase1-failover] ${message}`, meta ?? '');
};

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
      throw new Error('Failed to load HorologyKernel client constructor');
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
  log('No environment file found; relying on existing env');
}

const databaseUrl = process.env.KERNEL_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('KERNEL_DATABASE_URL or DATABASE_URL must be provided for failover harness');
}

const policySeeds = loadPolicySeeds();
if (policySeeds.length === 0) {
  throw new Error('No policy seeds configured; run apps/control-plane/scripts/seedPolicyData.ts');
}

const { tenantId } = policySeeds[0];

const truncateKernelTables = async (pool: import('pg').Pool) => {
  const statements = [
    'TRUNCATE timer_records RESTART IDENTITY',
    'TRUNCATE timer_command_log RESTART IDENTITY',
    'TRUNCATE tenant_quota_usage RESTART IDENTITY',
  ];
  for (const statement of statements) {
    await pool.query(statement);
  }
  try {
    await pool.query('TRUNCATE kernel_raft_state RESTART IDENTITY');
  } catch (error) {
    log('kernel_raft_state truncate skipped', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

type KernelInstance = {
  label: string;
  port: number;
  metricsPort: number;
  process: ChildProcessWithoutNullStreams;
};

const kernelBinaryPath = (() => {
  const crateDir = path.resolve(__dirname, '../../services/horology-kernel');
  const binaryName = process.platform === 'win32' ? 'kernel.exe' : 'kernel';
  const debugPath = path.join(crateDir, 'target', 'debug', binaryName);
  if (fs.existsSync(debugPath)) {
    return debugPath;
  }
  return debugPath; // build step below ensures it exists
})();

const buildKernelBinary = () => {
  const crateDir = path.resolve(__dirname, '../../services/horology-kernel');
  const result = spawnSync('cargo', ['build', '--bin', 'kernel'], {
    cwd: crateDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build horology kernel binary (status ${result.status})`);
  }
  if (!fs.existsSync(kernelBinaryPath)) {
    throw new Error(`Kernel binary not found after build at ${kernelBinaryPath}`);
  }
};

const startKernel = (label: string, port: number, metricsPort: number): KernelInstance => {
  const env = {
    ...process.env,
    RUST_LOG: process.env.RUST_LOG ?? 'info',
    KERNEL_STORE: 'postgres',
    KERNEL_DATABASE_URL: databaseUrl,
    KERNEL_GRPC_ADDR: `127.0.0.1:${port}`,
    KERNEL_METRICS_ADDR: `127.0.0.1:${metricsPort}`,
    KERNEL_NODE_ID: `kernel-${label}`,
    KERNEL_RAFT_HEARTBEAT_MS: process.env.KERNEL_RAFT_HEARTBEAT_MS ?? '200',
    KERNEL_RAFT_ELECTION_TIMEOUT_MS: process.env.KERNEL_RAFT_ELECTION_TIMEOUT_MS ?? '900',
  };

  const child = spawn(kernelBinaryPath, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[kernel-${label}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[kernel-${label}-err] ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    log(`Kernel ${label} exited`, { code, signal });
  });

  return { label, port, metricsPort, process: child };
};

const waitForGrpcServer = async (port: number, timeoutMs = 15_000) => {
  const KernelClient = loadKernelClientCtor();
  const deadline = Date.now() + timeoutMs;
  const client = new KernelClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  await new Promise<void>((resolve, reject) => {
    client.waitForReady(deadline, (error) => {
      client.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

const scheduleAgainst = async (port: number, attemptLabel: string) => {
  const KernelClient = loadKernelClientCtor();
  const client = new KernelClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  try {
    const metadata = new grpc.Metadata();
    metadata.set('x-attempt-label', attemptLabel);
    return await new Promise<{ response?: unknown; error?: grpc.ServiceError }>((resolve) => {
      client.ScheduleTimer(
        {
          tenantId,
          requestedBy: attemptLabel,
          name: `${attemptLabel}-${Date.now()}`,
          durationMs: 1500,
        },
        metadata,
        (error: grpc.ServiceError | null, response: unknown) => {
          if (error) {
            resolve({ error });
          } else {
            resolve({ response });
          }
        },
      );
    });
  } finally {
    client.close();
  }
};

const determineLeader = async (instances: KernelInstance[]) => {
  const results = await Promise.all(
    instances.map(async (instance) => {
      const outcome = await scheduleAgainst(instance.port, `leader-probe-${instance.label}`);
      return { instance, outcome };
    }),
  );

  const successful = results.filter((item) => item.outcome.response);
  if (successful.length !== 1) {
    const errors = results.map(({ instance, outcome }) => ({
      label: instance.label,
      errorCode: outcome.error?.code,
      message: outcome.error?.message,
    }));
    throw new Error(`Expected exactly one leader, received ${successful.length}`, { cause: errors });
  }

  const leader = successful[0].instance;
  const followers = results
    .filter((item) => item.instance.label !== leader.label)
    .map((item) => item.instance);

  results
    .filter((item) => item.instance.label !== leader.label)
    .forEach(({ instance, outcome }) => {
      if (!outcome.error || outcome.error.code !== grpc.status.FAILED_PRECONDITION) {
        throw new Error(
          `Expected follower ${instance.label} to return FAILED_PRECONDITION, got ${outcome.error?.code}`,
        );
      }
    });

  log('Detected leader instance', { leader: leader.label });
  return { leader, followers };
};

const awaitFailover = async (instance: KernelInstance, retries = 20) => {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const outcome = await scheduleAgainst(instance.port, `failover-probe-${attempt}`);
    if (outcome.response) {
      log('Failover successful', { newLeader: instance.label, attempts: attempt + 1 });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Follower ${instance.label} did not assume leadership within timeout`);
};

const shutdownKernel = async (instance: KernelInstance) => {
  if (instance.process.exitCode !== null) {
    return;
  }
  instance.process.kill('SIGINT');
  await once(instance.process, 'exit');
};

const main = async () => {
  buildKernelBinary();

  const pool = getPostgresPool();
  await ensurePolicySeeds(pool, policySeeds);
  await truncateKernelTables(pool);

  const kernelA = startKernel('a', 55101, 9551);
  const kernelB = startKernel('b', 55102, 9552);

  try {
    await Promise.all([waitForGrpcServer(kernelA.port), waitForGrpcServer(kernelB.port)]);

    const { leader, followers } = await determineLeader([kernelA, kernelB]);

    log('Stopping leader to trigger failover', { leader: leader.label });
    await shutdownKernel(leader);

    const newLeaderCandidate = followers[0];
    await waitForGrpcServer(newLeaderCandidate.port);
    await awaitFailover(newLeaderCandidate);
  } finally {
    await Promise.all([shutdownKernel(kernelA).catch(() => {}), shutdownKernel(kernelB).catch(() => {})]);
    await truncateKernelTables(pool);
    await closePostgresPool();
  }

  log('Kernel failover harness completed successfully');
};

main().catch((error) => {
  console.error('[phase1-failover] harness failed', error);
  process.exit(1);
});
