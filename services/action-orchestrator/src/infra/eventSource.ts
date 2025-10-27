import path from 'node:path';
import readline from 'node:readline';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import {
  AckPolicy,
  DeliverPolicy,
  JetStreamClient,
  JetStreamSubscription,
  RetentionPolicy,
  StorageType,
  Subscription,
  connect,
  consumerOpts,
  NatsConnection,
  StringCodec,
} from 'nats';
import { z } from 'zod';

import { logger } from '../logger';
import { TimerEvent, TimerInstance } from '../types';
import { DeadLetterQueue } from './deadLetterQueue';

const timerInstanceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  requestedBy: z.string(),
  status: z.enum(['scheduled', 'armed', 'fired', 'cancelled', 'failed', 'settled']),
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
      retryPolicy: z
        .object({
          maxAttempts: z.number().int().positive().optional(),
          backoffInitialMs: z.number().int().nonnegative().optional(),
          backoffMultiplier: z.number().positive().optional(),
        })
        .optional(),
    })
    .optional(),
  firedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelReason: z.string().optional(),
  cancelledBy: z.string().optional(),
  settledAt: z.string().optional(),
  failureReason: z.string().optional(),
  stateVersion: z.number().optional(),
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
    type: z.literal('settled'),
    data: timerInstanceSchema,
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
  const protoPath = path.resolve(__dirname, '../../../../proto/timer.proto');
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

type JetStreamConfig = {
  servers: string;
  stream: string;
  subject: string;
  durable: string;
  queue?: string;
  maxAckPending: number;
  maxDeliver: number;
  deadLetterSubject?: string;
};

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

export class JetStreamEventSource implements EventSource {
  private connection?: NatsConnection;
  private subscription?: JetStreamSubscription;
  private jetstream?: JetStreamClient;
  private deadLetter?: DeadLetterQueue;

  constructor(private readonly config: JetStreamConfig) {}

  async start(handler: EventHandler): Promise<void> {
    this.connection = await connect({ servers: this.config.servers });
    this.jetstream = this.connection.jetstream();
    if (this.config.deadLetterSubject) {
      this.deadLetter = new DeadLetterQueue(this.jetstream, this.config.deadLetterSubject);
    }

    const opts = consumerOpts();
    opts.durable(this.config.durable);
    opts.manualAck();
    opts.ackExplicit();
    opts.deliverNew();
    opts.maxAckPending(this.config.maxAckPending);
    opts.ackWait(30 * 1000);
    opts.filterSubject(this.config.subject);
    if (this.config.queue) {
      opts.queue(this.config.queue);
    }

    // Ensure the consumer exists with the configured parameters
    const manager = await this.connection.jetstreamManager();
    try {
      await manager.streams.info(this.config.stream);
    } catch (error) {
      await manager.streams.add({
        name: this.config.stream,
        subjects: [this.config.subject, this.config.deadLetterSubject ?? `${this.config.subject}.dlq`],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
      });
    }

    try {
      await manager.consumers.add(this.config.stream, {
        durable_name: this.config.durable,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subject: this.config.subject,
        max_deliver: this.config.maxDeliver,
        ack_wait: 30_000_000_000,
      });
    } catch (error) {
      // Consumer already exists; ignore duplicate errors
    }
    opts.bind(this.config.stream, this.config.durable);

    this.subscription = await this.jetstream.subscribe(this.config.subject, opts);
    const codec = StringCodec();

    logger.info(
      { subject: this.config.subject, durable: this.config.durable, queue: this.config.queue },
      'Connected to JetStream for timer events',
    );

    (async () => {
      for await (const message of this.subscription!) {
        let parsed: TimerEvent | null = null;
        try {
          const decoded = codec.decode(message.data);
          parsed = timerEventSchema.parse(JSON.parse(decoded));
        } catch (error) {
          logger.error({ error }, 'Failed to process JetStream timer event payload');
          await this.deadLetter?.publish(null, error);
          message.ack();
          continue;
        }

        try {
          await handler(parsed);
          message.ack();
        } catch (error) {
          logger.error({ error }, 'Timer handler failed for JetStream event');
          await this.deadLetter?.publish(parsed, error);
          message.ack();
        }
      }
    })();
  }

  async stop(): Promise<void> {
    await this.subscription?.drain();
    await this.connection?.drain();
  }
}

export const createEventSource = async (): Promise<EventSource> => {
  const jetStreamStream = process.env.NATS_JETSTREAM_STREAM;
  const jetStreamDurable = process.env.NATS_JETSTREAM_CONSUMER;
  if (jetStreamStream || jetStreamDurable) {
    const subject = process.env.NATS_SUBJECT ?? 'minoots.timer.fired';
    const servers = process.env.NATS_JETSTREAM_URL || process.env.NATS_URL || 'nats://localhost:4222';
    return new JetStreamEventSource({
      servers,
      stream: jetStreamStream ?? 'MINOOTS_TIMER',
      subject,
      durable: jetStreamDurable ?? 'ACTION_ORCHESTRATOR',
      queue: process.env.NATS_QUEUE_GROUP,
      maxAckPending: parseInt(process.env.NATS_MAX_ACK_PENDING ?? '512', 10),
      maxDeliver: parseInt(process.env.NATS_MAX_DELIVER ?? '10', 10),
      deadLetterSubject: process.env.NATS_DLQ_SUBJECT,
    });
  }

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
    case 'settled': {
      const timer = convertGrpcTimer(message.settled?.timer);
      return timer ? { type: 'settled', data: timer } : null;
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
    settledAt: optionalString(payload.settledAtIso),
    failureReason: optionalString(payload.failureReason),
    stateVersion: payload.stateVersion ? Number(payload.stateVersion) : undefined,
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
    case 'TIMER_STATUS_SETTLED':
    case 'settled':
    case '6':
      return 'settled';
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
