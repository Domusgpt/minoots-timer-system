import path from 'node:path';
import { connect, NatsConnection, StringCodec, Subscription } from 'nats';
import readline from 'node:readline';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { z } from 'zod';
import { logger } from '../logger';
import { TimerEvent, TimerInstance, TimerAction } from '../types';

const PROTO_PATH = path.resolve(__dirname, '..', '..', '..', 'proto', 'timer.proto');

const timerActionSchema: z.ZodType<TimerAction> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(['webhook', 'command', 'agent_prompt', 'workflow_event']),
    parameters: z.record(z.any()).default({}),
    escalation: z
      .object({
        afterAttempts: z.number().optional(),
        escalatesTo: timerActionSchema.optional(),
      })
      .optional(),
  }),
);

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
      actions: z.array(timerActionSchema).default([]),
      concurrency: z.number().optional(),
      retryPolicy: z
        .object({
          maxAttempts: z.number().optional(),
          backoffInitialMs: z.number().optional(),
          backoffMultiplier: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  firedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelReason: z.string().optional(),
  cancelledBy: z.string().optional(),
  agentBinding: z
    .object({
      adapter: z.string(),
      target: z.string(),
      payloadTemplate: z.record(z.any()).default({}),
      acknowledgementTimeoutMs: z.number().optional(),
    })
    .optional(),
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
]);

type GrpcClient = grpc.Client & {
  streamTimerEvents: (request: unknown) => grpc.ClientReadableStream<any>;
};

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const KernelService = descriptor.minoots.timer.v1.HorologyKernel as {
  new (address: string, credentials: grpc.ChannelCredentials): GrpcClient;
};

const STATUS_MAP: Record<string, TimerInstance['status']> = {
  TIMER_STATUS_UNSPECIFIED: 'scheduled',
  TIMER_STATUS_SCHEDULED: 'scheduled',
  TIMER_STATUS_ARMED: 'armed',
  TIMER_STATUS_FIRED: 'fired',
  TIMER_STATUS_CANCELLED: 'cancelled',
  TIMER_STATUS_FAILED: 'failed',
};

const fromTimestamp = (value?: { seconds?: string | number; nanos?: string | number }): string | undefined => {
  if (!value) {
    return undefined;
  }
  const secondsRaw = value.seconds ?? 0;
  const nanosRaw = value.nanos ?? 0;
  const seconds = typeof secondsRaw === 'string' ? Number.parseInt(secondsRaw, 10) : Number(secondsRaw);
  const nanos = typeof nanosRaw === 'string' ? Number.parseInt(nanosRaw, 10) : Number(nanosRaw);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
    return undefined;
  }
  const millis = seconds * 1000 + Math.floor(nanos / 1_000_000);
  return new Date(millis).toISOString();
};

const decodeValue = (value: any): unknown => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const typed = value as Record<string, unknown> & { kind?: string };
  switch (typed.kind) {
    case 'nullValue':
      return null;
    case 'boolValue':
      return Boolean(typed.boolValue);
    case 'numberValue':
      return typeof typed.numberValue === 'string'
        ? Number.parseFloat(typed.numberValue)
        : Number(typed.numberValue ?? 0);
    case 'stringValue':
      return typed.stringValue ?? '';
    case 'listValue': {
      const list = (typed.listValue as { values?: any[] })?.values ?? [];
      return list.map((item) => decodeValue(item));
    }
    case 'structValue':
      return decodeStruct(typed.structValue as { fields?: Record<string, any> });
    default:
      return null;
  }
};

const decodeStruct = (struct?: { fields?: Record<string, any> }): Record<string, unknown> | undefined => {
  if (!struct || typeof struct !== 'object' || !('fields' in struct)) {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(struct.fields ?? {})) {
    output[key] = decodeValue(value);
  }
  return output;
};

const decodeAction = (action: any): TimerAction => {
  const parameters = decodeStruct(action.parameters) ?? {};
  const escalation = action.escalation
    ? {
        afterAttempts: Number(action.escalation.afterAttempts ?? 1),
        escalatesTo: action.escalation.escalatesTo ? decodeAction(action.escalation.escalatesTo) : undefined,
      }
    : undefined;
  return {
    id: action.id,
    kind: action.kind,
    parameters,
    escalation,
  };
};

const decodeActionBundle = (bundle: any): TimerInstance['actionBundle'] => {
  if (!bundle) {
    return undefined;
  }
  const actions = Array.isArray(bundle.actions) ? bundle.actions.map((item: any) => decodeAction(item)) : [];
  const retryPolicy = bundle.retryPolicy
    ? {
        maxAttempts: Number(bundle.retryPolicy.maxAttempts ?? 1),
        backoffInitialMs: Number(bundle.retryPolicy.backoffInitialMs ?? 1000),
        backoffMultiplier: Number(bundle.retryPolicy.backoffMultiplier ?? 2),
      }
    : undefined;
  return {
    actions,
    concurrency: bundle.concurrency ? Number(bundle.concurrency) : undefined,
    retryPolicy,
  };
};

const decodeAgentBinding = (binding: any): TimerInstance['agentBinding'] => {
  if (!binding) {
    return undefined;
  }
  return {
    adapter: binding.adapter,
    target: binding.target,
    payloadTemplate: decodeStruct(binding.payloadTemplate) ?? {},
    acknowledgementTimeoutMs: Number(binding.acknowledgementTimeoutMs ?? 60000),
  };
};

const mapTimer = (timer: any): TimerInstance => {
  const statusKey = typeof timer.status === 'string' ? timer.status : '';
  const status = STATUS_MAP[statusKey] ?? 'scheduled';
  return {
    id: timer.id,
    tenantId: timer.tenantId,
    name: timer.name,
    requestedBy: timer.requestedBy,
    status,
    fireAt: fromTimestamp(timer.fireAt) ?? new Date().toISOString(),
    createdAt: fromTimestamp(timer.createdAt) ?? new Date().toISOString(),
    durationMs: Number(timer.durationMs ?? 0),
    metadata: decodeStruct(timer.metadata) ?? undefined,
    labels: timer.labels ?? undefined,
    actionBundle: decodeActionBundle(timer.actionBundle),
    agentBinding: decodeAgentBinding(timer.agentBinding),
    firedAt: fromTimestamp(timer.firedAt),
    cancelledAt: fromTimestamp(timer.cancelledAt),
    cancelReason: timer.cancelReason || undefined,
    cancelledBy: timer.cancelledBy || undefined,
  };
};

const mapGrpcEvent = (payload: any): TimerEvent | null => {
  if (!payload || typeof payload !== 'object' || !('event' in payload)) {
    return null;
  }
  const event = payload.event;
  if (event.scheduled?.timer) {
    return { type: 'scheduled', data: mapTimer(event.scheduled.timer) };
  }
  if (event.fired?.timer) {
    return { type: 'fired', data: mapTimer(event.fired.timer) };
  }
  if (event.cancelled?.timer) {
    return {
      type: 'cancelled',
      data: {
        timer: mapTimer(event.cancelled.timer),
        reason: event.cancelled.reason || undefined,
      },
    };
  }
  return null;
};

type EventHandler = (event: TimerEvent) => Promise<void>;

export interface EventSource {
  start(handler: EventHandler): Promise<void>;
  stop(): Promise<void>;
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

export class GrpcEventSource implements EventSource {
  private client?: GrpcClient;
  private stream?: grpc.ClientReadableStream<any>;

  constructor(
    private readonly address: string,
    private readonly tenantId?: string,
    private readonly topics: string[] = [],
  ) {}

  async start(handler: EventHandler): Promise<void> {
    this.client = new KernelService(this.address, grpc.credentials.createInsecure());
    const request = {
      tenantId: this.tenantId ?? '',
      topics: this.topics,
    };
    this.stream = this.client.streamTimerEvents(request);
    logger.info({ address: this.address, tenantId: request.tenantId }, 'Subscribed to kernel gRPC event stream');

    this.stream.on('data', async (payload) => {
      try {
        const event = mapGrpcEvent(payload);
        if (!event) {
          logger.warn({ payload }, 'Received unknown kernel event');
          return;
        }
        await handler(event);
      } catch (error) {
        logger.error({ error, payload }, 'Failed to process kernel gRPC event');
      }
    });

    this.stream.on('error', (error) => {
      logger.error({ error }, 'Kernel gRPC event stream error');
    });

    this.stream.on('end', () => {
      logger.warn('Kernel gRPC event stream ended');
    });
  }

  async stop(): Promise<void> {
    this.stream?.cancel();
  }
}

export const createEventSource = async (): Promise<EventSource> => {
  const grpcAddress = process.env.KERNEL_GRPC_URL;
  if (grpcAddress) {
    const topics = (process.env.KERNEL_EVENT_TOPICS ?? '')
      .split(',')
      .map((topic) => topic.trim())
      .filter((topic) => topic.length > 0);
    return new GrpcEventSource(grpcAddress, process.env.KERNEL_EVENT_TENANT_ID, topics);
  }
  const servers = process.env.NATS_URL;
  if (servers) {
    return new NatsEventSource(servers, process.env.NATS_SUBJECT);
  }
  return new StdInEventSource();
};
