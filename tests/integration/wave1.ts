import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import type { Client } from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { connect, StringCodec, JetStreamClient, NatsConnection } from 'nats';

export type Wave1HarnessOptions = {
  restBaseUrl: string;
  grpcAddress?: string;
  natsUrl?: string;
  natsSubject: string;
  tenantId: string;
  apiKey: string;
  scheduleDurationMs: number;
  requestActor: string;
  metadata?: Record<string, unknown>;
};

export type Wave1HarnessResult = {
  restTimerId?: string;
  grpcTimerId?: string;
  jetStreamEvent?: unknown;
  logs: string[];
};

const DEFAULTS: Wave1HarnessOptions = {
  restBaseUrl: process.env.CONTROL_PLANE_HTTP_URL ?? 'http://127.0.0.1:4000',
  grpcAddress: process.env.CONTROL_PLANE_GRPC_URL ?? process.env.KERNEL_GRPC_URL ?? '127.0.0.1:50051',
  natsUrl: process.env.NATS_JETSTREAM_URL ?? process.env.NATS_URL,
  natsSubject: process.env.NATS_SUBJECT ?? 'minoots.timer.fired',
  tenantId: process.env.TEST_TENANT_ID ?? 'development',
  apiKey: process.env.TEST_API_KEY ?? 'local-dev-key',
  scheduleDurationMs: Number(process.env.TEST_TIMER_DURATION_MS ?? 1500),
  requestActor: process.env.TEST_REQUEST_ACTOR ?? 'wave1-harness',
  metadata: undefined,
};

export async function runWave1Harness(
  overrides: Partial<Wave1HarnessOptions> = {},
): Promise<Wave1HarnessResult> {
  const options: Wave1HarnessOptions = { ...DEFAULTS, ...overrides };
  const result: Wave1HarnessResult = { logs: [] };

  const http = buildHttpClient(options);
  let natsConnection: NatsConnection | undefined;
  let jetstream: JetStreamClient | undefined;
  let eventPromise: Promise<unknown> | undefined;

  try {
    if (options.natsUrl) {
      natsConnection = await connect({ servers: options.natsUrl });
      jetstream = natsConnection.jetstream();
      result.logs.push(`Connected to NATS at ${options.natsUrl}`);
      eventPromise = waitForEvent(jetstream, options.natsSubject, result.logs);
    } else {
      result.logs.push('NATS connection skipped (NATS_URL not provided)');
    }
  } catch (error) {
    result.logs.push(`Failed to initialize NATS listener: ${String(error)}`);
  }

  try {
    const restTimer = await scheduleViaRest(http, options);
    result.restTimerId = restTimer;
    result.logs.push(`REST schedule succeeded with timer ${restTimer}`);
  } catch (error) {
    result.logs.push(`REST schedule failed: ${String(error)}`);
  }

  try {
    if (options.grpcAddress) {
      const grpcTimer = await scheduleViaGrpc(options);
      result.grpcTimerId = grpcTimer;
      result.logs.push(`gRPC schedule succeeded with timer ${grpcTimer}`);
    } else {
      result.logs.push('gRPC schedule skipped (no address configured)');
    }
  } catch (error) {
    result.logs.push(`gRPC schedule failed: ${String(error)}`);
  }

  if (eventPromise) {
    const event = await eventPromise.catch((error) => {
      result.logs.push(`JetStream wait failed: ${String(error)}`);
      return undefined;
    });
    if (event) {
      result.jetStreamEvent = event;
      result.logs.push('JetStream event received');
    } else {
      result.logs.push('JetStream event not observed within timeout window');
    }
  }

  if (natsConnection) {
    await natsConnection.drain().catch(() => undefined);
  }

  return result;
}

function buildHttpClient(options: Wave1HarnessOptions): AxiosInstance {
  const headers: Record<string, string> = {
    'x-api-key': options.apiKey,
    'x-tenant-id': options.tenantId,
    'content-type': 'application/json',
  };
  if (process.env.X_TRACE_ID) {
    headers['x-trace-id'] = process.env.X_TRACE_ID;
  }
  if (process.env.X_REQUEST_ID) {
    headers['x-request-id'] = process.env.X_REQUEST_ID;
  }

  return axios.create({
    baseURL: options.restBaseUrl,
    headers,
    timeout: Number(process.env.TEST_HTTP_TIMEOUT_MS ?? 10_000),
  });
}

async function scheduleViaRest(http: AxiosInstance, options: Wave1HarnessOptions): Promise<string> {
  const now = new Date();
  const name = `wave1-rest-${now.toISOString()}`;
  const payload = {
    tenantId: options.tenantId,
    requestedBy: options.requestActor,
    name,
    durationMs: options.scheduleDurationMs,
    metadata: options.metadata ?? { harness: 'wave1', channel: 'rest' },
    actionBundle: { kind: 'webhook', url: 'http://localhost:4001/mock' },
    labels: { harness: 'wave1' },
    agentBinding: { mode: 'solo', target: options.requestActor },
  };

  const response = await http.post('/timers', payload);
  return response.data.id as string;
}

async function scheduleViaGrpc(options: Wave1HarnessOptions): Promise<string> {
  const protoPath = path.resolve(process.cwd(), 'proto/timer.proto');
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    defaults: true,
    longs: String,
    enums: String,
    oneofs: true,
  });
  const loaded = loadPackageDefinition(packageDefinition) as any;
  const service = loaded.minoots?.timer?.v1?.HorologyKernel as
    | (new (address: string, creds: ReturnType<typeof credentials.createInsecure>) => Client & {
        ScheduleTimer: (request: unknown, callback: (error: unknown, response: any) => void) => void;
      })
    | undefined;
  if (!service) {
    throw new Error('HorologyKernel service definition not found in proto');
  }
  const client = new service(options.grpcAddress, credentials.createInsecure());

  const now = new Date();
  const request = {
    tenant_id: options.tenantId,
    requested_by: options.requestActor,
    name: `wave1-grpc-${now.toISOString()}`,
    duration_ms: options.scheduleDurationMs,
    metadata_json: JSON.stringify(options.metadata ?? { harness: 'wave1', channel: 'grpc' }),
    action_bundle_json: JSON.stringify({ kind: 'noop' }),
    agent_binding_json: JSON.stringify({ mode: 'solo', target: options.requestActor }),
    labels: { harness: 'wave1' },
  };

  try {
    const timer = await new Promise<string>((resolve, reject) => {
      client.ScheduleTimer(request, (error: unknown, response: any) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response?.timer?.id);
      });
    });
    return timer;
  } finally {
    client.close();
  }
}

async function waitForEvent(
  jetstream: JetStreamClient,
  subject: string,
  logs: string[],
): Promise<unknown> {
  const codec = StringCodec();
  const subscription = await jetstream.subscribe(subject, { max: 1 });
  logs.push(`Subscribed to JetStream subject ${subject}`);

  return new Promise(async (resolve) => {
    const timeout = Number(process.env.TEST_JETSTREAM_TIMEOUT_MS ?? 15_000);
    const timer = setTimeout(() => {
      try {
        subscription.unsubscribe();
      } catch (error) {
        logs.push(`Failed to unsubscribe JetStream listener: ${String(error)}`);
      }
      resolve(undefined);
    }, timeout);

    for await (const message of subscription) {
      clearTimeout(timer);
      const decoded = codec.decode(message.data);
      message.ack();
      try {
        resolve(JSON.parse(decoded));
      } catch (error) {
        logs.push(`Failed to parse JetStream payload: ${String(error)}`);
        resolve({ raw: decoded });
      }
      try {
        subscription.unsubscribe();
      } catch (error) {
        logs.push(`JetStream unsubscribe error: ${String(error)}`);
      }
      break;
    }
  });
}

if (require.main === module) {
  runWave1Harness()
    .then(async (result) => {
      console.log('Wave 1 integration harness complete');
      console.log(JSON.stringify(result, null, 2));
      if (!result.jetStreamEvent) {
        await delay(0);
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error('Wave 1 integration harness failed', error);
      process.exitCode = 1;
    });
}
