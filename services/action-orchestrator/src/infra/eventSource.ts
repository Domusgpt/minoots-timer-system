import path from 'node:path';
import readline from 'node:readline';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { connect, NatsConnection, StringCodec, Subscription } from 'nats';
import { z } from 'zod';

import { logger } from '../logger';
import {
  TimerEvent,
  TimerInstance,
  TimerExecutionResult,
  TimerExecutionError,
  ActionExecutionResult,
} from '../types';

const actionResultSchema = z.object({
  actionId: z.string(),
  success: z.boolean(),
  output: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const executionResultSchema = z
  .object({
    actions: z.array(actionResultSchema).default([]),
    completedAtIso: z.string().optional(),
  })
  .optional();

const executionErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .optional();

const timerInstanceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  requestedBy: z.string(),
  status: z.enum(['scheduled', 'armed', 'fired', 'cancelled', 'failed']),
  fireAt: z.string(),
  createdAt: z.string(),
  durationMs: z.number(),
  metadata: z.record(z.any()).optional(),
  labels: z.record(z.string()).optional(),
  actionBundle: z
    .object({
      actions: z
        .array(
          z.object({
            id: z.string(),
            kind: z.string(),
            parameters: z.record(z.any()).default({}),
          }),
        )
        .default([]),
      concurrency: z.number().optional(),
    })
    .optional(),
  firedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelReason: z.string().optional(),
  cancelledBy: z.string().optional(),
  executionResult: executionResultSchema,
  executionError: executionErrorSchema,
});

const timerEventSchema: z.ZodType<TimerEvent> = z.union([
  z.object({
    type: z.literal('scheduled'),
    data: timerInstanceSchema,
  }) as z.ZodType<TimerEvent>,
  z.object({
    type: z.literal('fired'),
    data: timerInstanceSchema,
  }) as z.ZodType<TimerEvent>,
  z.object({
    type: z.literal('cancelled'),
    data: z.object({ timer: timerInstanceSchema, reason: z.string().optional() }),
  }) as z.ZodType<TimerEvent>,
  z.object({
    type: z.literal('failed'),
    data: z.object({ timer: timerInstanceSchema, error: executionErrorSchema }),
  }) as z.ZodType<TimerEvent>,
]);

type EventHandler = (event: TimerEvent) => Promise<void>;

type GrpcKernelClient = grpc.Client & {
  streamTimerEvents: (request: any) => grpc.ClientReadableStream<any>;
};

const loaderOptions: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

type KernelClientConstructor = new (
  address: string,
  credentials: grpc.ChannelCredentials,
) => GrpcKernelClient;

let kernelClientCtor: KernelClientConstructor | undefined;

const loadKernelClientCtor = (): KernelClientConstructor => {
  if (kernelClientCtor) {
    return kernelClientCtor;
  }
  const protoPath = path.resolve(__dirname, '../../../proto/timer.proto');
  const packageDefinition = protoLoader.loadSync(protoPath, loaderOptions);
  const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
  const ctor = descriptor?.minoots?.timer?.v1?.HorologyKernel;
  if (!ctor) {
    throw new Error('Failed to load HorologyKernel gRPC client definition');
  }
  kernelClientCtor = ctor as KernelClientConstructor;
  return kernelClientCtor;
};

export interface EventSource {
  start(handler: EventHandler): Promise<void>;
  stop(): Promise<void>;
}

export class GrpcEventSource implements EventSource {
  private client?: GrpcKernelClient;
  private stream?: grpc.ClientReadableStream<any>;

  constructor(private readonly address: string, private readonly tenantId: string) {}

  async start(handler: EventHandler): Promise<void> {
    const ClientCtor = loadKernelClientCtor();
    this.client = new ClientCtor(this.address, grpc.credentials.createInsecure());
    const request = { tenantId: this.tenantId, topics: [] as string[] };
    this.stream = this.client.streamTimerEvents(request);

    this.stream.on('data', (message) => {
      try {
        const event = convertGrpcEvent(message);
        if (!event) {
          return;
        }
        handler(event).catch((error) => {
          logger.error({ error }, 'Timer handler failed for gRPC event');
        });
      } catch (error) {
        logger.error({ error, message }, 'Failed to process gRPC timer event');
      }
    });

    this.stream.on('error', (error) => {
      logger.error({ error }, 'gRPC timer event stream error');
    });

    this.stream.on('end', () => {
      logger.warn('gRPC timer event stream ended');
    });

    logger.info({ address: this.address, tenantId: this.tenantId }, 'Subscribed to horology kernel via gRPC');
  }

  async stop(): Promise<void> {
    this.stream?.cancel();
    this.client?.close?.();
  }
}

export class NatsEventSource implements EventSource {
  private connection?: NatsConnection;
  private subscription?: Subscription;
  private readonly subject: string;

  constructor(private readonly servers: string, subject?: string) {
    this.subject = subject ?? 'minoots.timer.fired';
  }

  async start(handler: EventHandler): Promise<void> {
    this.connection = await connect({ servers: this.servers });
    const codec = StringCodec();
    this.subscription = this.connection.subscribe(this.subject);
    logger.info({ subject: this.subject }, 'Connected to NATS for timer events');

    (async () => {
      for await (const message of this.subscription!) {
        try {
          const decoded = codec.decode(message.data);
          const parsed = timerEventSchema.parse(JSON.parse(decoded));
          await handler(parsed);
        } catch (error) {
          logger.error({ error }, 'Failed to process NATS timer event');
        }
      }
    })();
  }

  async stop(): Promise<void> {
    await this.subscription?.drain();
    await this.connection?.drain();
  }
}

export class StdInEventSource implements EventSource {
  private rl?: readline.Interface;

  async start(handler: EventHandler): Promise<void> {
    this.rl = readline.createInterface({ input: process.stdin });
    logger.info('Reading timer events from STDIN (JSON per line)');
    this.rl.on('line', async (line) => {
      try {
        const parsed = timerEventSchema.parse(JSON.parse(line));
        await handler(parsed);
      } catch (error) {
        logger.error({ error, line }, 'Failed to process STDIN timer event');
      }
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}

export const createEventSource = async (): Promise<EventSource> => {
  const grpcUrl = process.env.KERNEL_GRPC_URL || process.env.KERNEL_GRPC_ADDR;
  if (grpcUrl) {
    const tenantId = process.env.KERNEL_EVENT_TENANT_ID || process.env.EVENT_TENANT_ID || '__all__';
    return new GrpcEventSource(grpcUrl, tenantId);
  }

  const servers = process.env.NATS_URL;
  if (servers) {
    return new NatsEventSource(servers, process.env.NATS_SUBJECT);
  }

  logger.warn('Falling back to STDIN for timer events');
  return new StdInEventSource();
};

const convertGrpcEvent = (message: any): TimerEvent | null => {
  if (!message) {
    return null;
  }
  const variant = typeof message.event === 'string' ? message.event : undefined;
  switch (variant) {
    case 'scheduled': {
      const timer = convertGrpcTimer(message.scheduled?.timer);
      return timer ? { type: 'scheduled', data: timer } : null;
    }
    case 'fired': {
      const timer = convertGrpcTimer(message.fired?.timer);
      return timer ? { type: 'fired', data: timer } : null;
    }
    case 'cancelled': {
      const timer = convertGrpcTimer(message.cancelled?.timer);
      if (!timer) {
        return null;
      }
      const reason = optionalString(message.cancelled?.reason);
      return { type: 'cancelled', data: { timer, reason } };
    }
    case 'failed': {
      const timer = convertGrpcTimer(message.failed?.timer);
      if (!timer) {
        return null;
      }
      const error = convertExecutionError(message.failed?.error);
      return { type: 'failed', data: { timer, error } };
    }
    default:
      return null;
  }
};

const convertGrpcTimer = (payload: any): TimerInstance | null => {
  if (!payload) {
    return null;
  }

  const timer: TimerInstance = {
    id: payload.id,
    tenantId: payload.tenantId,
    name: payload.name,
    requestedBy: payload.requestedBy,
    status: mapStatus(payload.status),
    fireAt: payload.fireAtIso ?? new Date().toISOString(),
    createdAt: payload.createdAtIso ?? new Date().toISOString(),
    durationMs: Number(payload.durationMs ?? 0),
    metadata: parseJson(payload.metadataJson),
    labels: convertStringMap(payload.labels),
    actionBundle: parseJson(payload.actionBundleJson) as TimerInstance['actionBundle'],
    firedAt: optionalString(payload.firedAtIso),
    cancelledAt: optionalString(payload.cancelledAtIso),
    cancelReason: optionalString(payload.cancelReason),
    cancelledBy: optionalString(payload.cancelledBy),
    executionResult: convertExecutionResult(payload.executionResult),
    executionError: convertExecutionError(payload.executionError),
  };

  return timer;
};

const mapStatus = (status: unknown): TimerInstance['status'] => {
  const value = typeof status === 'string' ? status : String(status ?? '');
  switch (value) {
    case 'TIMER_STATUS_ARMED':
    case 'armed':
    case '2':
      return 'armed';
    case 'TIMER_STATUS_FIRED':
    case 'fired':
    case '3':
      return 'fired';
    case 'TIMER_STATUS_CANCELLED':
    case 'cancelled':
    case '4':
      return 'cancelled';
    case 'TIMER_STATUS_FAILED':
    case 'failed':
    case '5':
      return 'failed';
    case 'TIMER_STATUS_SCHEDULED':
    case 'scheduled':
    case '1':
      return 'scheduled';
    case 'TIMER_STATUS_UNSPECIFIED':
    case '0':
    default:
      return 'scheduled';
  }
};

const convertStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, val]) => {
      if (typeof val === 'string') {
        acc[key] = val;
      } else if (val != null) {
        acc[key] = String(val);
      }
      return acc;
    },
    {},
  );
  return Object.keys(entries).length > 0 ? entries : undefined;
};

const parseJson = <T>(value?: string): T | undefined => {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error({ error, value }, 'Failed to parse JSON payload from gRPC event');
    return undefined;
  }
};

const optionalString = (value?: string): string | undefined => {
  if (!value || value.length === 0) {
    return undefined;
  }
  return value;
};

const convertExecutionResult = (payload: unknown): TimerExecutionResult | undefined => {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const rawActions = Array.isArray(record.actions) ? (record.actions as unknown[]) : [];
  const actions = rawActions.reduce<ActionExecutionResult[]>((acc, entry) => {
    if (!entry || typeof entry !== 'object') {
      return acc;
    }
    const actionRecord = entry as Record<string, unknown>;
    const actionId = actionRecord.actionId;
    if (typeof actionId !== 'string' || actionId.length === 0) {
      return acc;
    }

    const result: ActionExecutionResult = {
      actionId,
      success: Boolean(actionRecord.success),
    };

    const output = optionalString(actionRecord.output as string | undefined);
    if (output !== undefined) {
      result.output = output;
    }

    const metadata = parseJson<Record<string, unknown>>(actionRecord.metadataJson as string | undefined);
    if (metadata) {
      result.metadata = metadata;
    }

    acc.push(result);
    return acc;
  }, []);

  const completedAtIso = optionalString(record.completedAtIso as string | undefined);

  if (actions.length === 0 && !completedAtIso) {
    return undefined;
  }

  return { actions, completedAtIso };
};

const convertExecutionError = (payload: unknown): TimerExecutionError | undefined => {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const message = optionalString(record.message as string | undefined);
  const code = optionalString(record.code as string | undefined);
  const metadata = parseJson(record.metadataJson as string | undefined) as Record<string, unknown> | undefined;

  if (!message && !code && !metadata) {
    return undefined;
  }

  return {
    message: message ?? 'Timer execution failed',
    code: code ?? undefined,
    metadata,
  };
};
