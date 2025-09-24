import { connect, NatsConnection, StringCodec, Subscription } from 'nats';
import readline from 'node:readline';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../logger';
import { TimerEvent, TimerInstance, TimerAction } from '../types';

const timerInstanceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  requestedBy: z.string(),
  status: z.enum(['scheduled', 'armed', 'fired', 'cancelled']),
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
    data: z.object({ timer: timerInstanceSchema, error: z.string().optional() }),
  }) as z.ZodType<TimerEvent>,
]);

type EventHandler = (event: TimerEvent) => Promise<void>;

export interface EventSource {
  start(handler: EventHandler): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_GRPC_ADDR = process.env.KERNEL_GRPC_ADDR ?? '0.0.0.0:50051';
const PROTO_PATH = process.env.KERNEL_PROTO_PATH ?? path.resolve(__dirname, '../../../..', 'proto', 'timer.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loaded = grpc.loadPackageDefinition(packageDefinition) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HorologyKernelClientCtor = loaded?.minoots?.timer?.v1?.HorologyKernel as grpc.ServiceClientConstructor;

class GrpcEventSource implements EventSource {
  private readonly client: grpc.Client;
  private stream?: grpc.ClientReadableStream<unknown>;

  constructor(private readonly address: string = DEFAULT_GRPC_ADDR) {
    if (!HorologyKernelClientCtor) {
      throw new Error('HorologyKernel service definition unavailable');
    }
    this.client = new HorologyKernelClientCtor(address, grpc.credentials.createInsecure());
  }

  async start(handler: EventHandler): Promise<void> {
    const tenantId = process.env.KERNEL_EVENT_TENANT ?? '';
    const topics = (process.env.KERNEL_EVENT_TOPICS ?? '')
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: grpc.ClientReadableStream<unknown> = (this.client as any).streamTimerEvents({ tenantId, topics });
    this.stream = stream;

    stream.on('data', async (payload: unknown) => {
      try {
        const event = fromProtoEvent(payload);
        if (event) {
          await handler(event);
        }
      } catch (error) {
        logger.error({ error }, 'Failed to handle gRPC timer event');
      }
    });

    stream.on('error', (error: grpc.ServiceError) => {
      logger.error({ error }, 'Timer event stream encountered an error');
    });

    stream.on('end', () => {
      logger.warn('Timer event stream closed by kernel');
    });
  }

  async stop(): Promise<void> {
    this.stream?.cancel();
    this.client.close();
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
  const servers = process.env.NATS_URL;
  if (servers) {
    return new NatsEventSource(servers, process.env.NATS_SUBJECT);
  }
  if (HorologyKernelClientCtor) {
    try {
      return new GrpcEventSource();
    } catch (error) {
      logger.error({ error }, 'Falling back from gRPC event source');
    }
  }
  return new StdInEventSource();
};

type TimestampLike = { seconds: number | string; nanos?: number };

function fromProtoEvent(payload: unknown): TimerEvent | null {
  const event = payload as Record<string, unknown>;
  const kind = event.event as string | undefined;

  switch (kind) {
    case 'scheduled': {
      const scheduled = event.scheduled as Record<string, unknown> | undefined;
      const timer = scheduled?.timer;
      return timer ? { type: 'scheduled', data: fromProtoTimer(timer) } : null;
    }
    case 'fired': {
      const fired = event.fired as Record<string, unknown> | undefined;
      const timer = fired?.timer;
      return timer ? { type: 'fired', data: fromProtoTimer(timer) } : null;
    }
    case 'cancelled': {
      const cancelled = event.cancelled as Record<string, unknown> | undefined;
      const timer = cancelled?.timer;
      if (!timer) {
        return null;
      }
      return {
        type: 'cancelled',
        data: {
          timer: fromProtoTimer(timer),
          reason: stringOrUndefined(cancelled?.reason),
        },
      };
    }
    case 'failed': {
      const failed = event.failed as Record<string, unknown> | undefined;
      const timer = failed?.timer;
      if (!timer) {
        return null;
      }
      const errorInfo = failed?.error as Record<string, unknown> | undefined;
      return {
        type: 'failed',
        data: {
          timer: fromProtoTimer(timer),
          error: stringOrUndefined(errorInfo?.message),
        },
      };
    }
    default:
      return null;
  }
}

function fromProtoTimer(raw: unknown): TimerInstance {
  const timer = raw as Record<string, unknown>;
  const createdAt = timestampToIso(timer.createdAt as TimestampLike | undefined);
  const fireAt = timestampToIso(timer.fireAt as TimestampLike | undefined);

  if (!createdAt || !fireAt) {
    throw new Error('Timer payload missing timestamps');
  }

  return {
    id: String(timer.id ?? ''),
    tenantId: String(timer.tenantId ?? ''),
    name: String(timer.name ?? ''),
    requestedBy: String(timer.requestedBy ?? ''),
    status: mapStatus(String(timer.status ?? '')),
    fireAt,
    createdAt,
    durationMs: Number(timer.durationMs ?? 0),
    metadata: (timer.metadata as Record<string, unknown> | undefined) ?? undefined,
    labels: (timer.labels as Record<string, string> | undefined) ?? undefined,
    actionBundle: timer.actionBundle
      ? fromProtoActionBundle(timer.actionBundle as Record<string, unknown>)
      : undefined,
    firedAt: timestampToIso(timer.firedAt as TimestampLike | undefined),
    cancelledAt: timestampToIso(timer.cancelledAt as TimestampLike | undefined),
    cancelReason: stringOrUndefined(timer.cancelReason),
    cancelledBy: stringOrUndefined(timer.cancelledBy),
    agentBinding: timer.agentBinding
      ? fromProtoAgentBinding(timer.agentBinding as Record<string, unknown>)
      : undefined,
  };
}

function fromProtoActionBundle(raw: Record<string, unknown>): TimerInstance['actionBundle'] {
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map((action) => fromProtoAction(action as Record<string, unknown>))
    : [];
  const retryPolicy = raw.retryPolicy as Record<string, unknown> | undefined;

  return {
    actions,
    concurrency: typeof raw.concurrency === 'number' ? raw.concurrency : undefined,
    retryPolicy: retryPolicy
      ? {
          maxAttempts: Number(retryPolicy.maxAttempts ?? 0),
          backoffInitialMs: Number(retryPolicy.backoffInitialMs ?? 0),
          backoffMultiplier: Number(retryPolicy.backoffMultiplier ?? 0),
        }
      : undefined,
  };
}

function fromProtoAction(raw: Record<string, unknown>): TimerAction {
  const escalation = raw.escalation as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? ''),
    kind: raw.kind as TimerAction['kind'],
    parameters: (raw.parameters as Record<string, unknown> | undefined) ?? {},
    escalation: escalation
      ? {
          afterAttempts: Number(escalation.afterAttempts ?? 0),
          escalatesTo: escalation.escalatesTo
            ? fromProtoAction(escalation.escalatesTo as Record<string, unknown>)
            : undefined,
        }
      : undefined,
  };
}

function fromProtoAgentBinding(raw: Record<string, unknown>): TimerInstance['agentBinding'] {
  return {
    adapter: String(raw.adapter ?? ''),
    target: String(raw.target ?? ''),
    payloadTemplate: (raw.payloadTemplate as Record<string, unknown> | undefined) ?? {},
    acknowledgementTimeoutMs: Number(raw.acknowledgementTimeoutMs ?? 0),
  };
}

function mapStatus(status: string): TimerInstance['status'] {
  switch (status) {
    case 'TIMER_STATUS_ARMED':
      return 'armed';
    case 'TIMER_STATUS_FIRED':
      return 'fired';
    case 'TIMER_STATUS_CANCELLED':
      return 'cancelled';
    case 'TIMER_STATUS_FAILED':
      return 'failed';
    case 'TIMER_STATUS_SCHEDULED':
    default:
      return 'scheduled';
  }
}

function timestampToIso(timestamp?: TimestampLike): string | undefined {
  if (!timestamp) {
    return undefined;
  }
  const seconds = typeof timestamp.seconds === 'string' ? Number(timestamp.seconds) : timestamp.seconds;
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  const nanos = timestamp.nanos ?? 0;
  return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
