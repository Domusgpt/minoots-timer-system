import path from 'node:path';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { v4 as uuid } from 'uuid';

import { TimerRepository } from '../store/timerRepository';
import { createTimerRepository } from '../store/createTimerRepository';
import { TimerRecord, TimerActionBundle, AgentBinding, TimerStatus } from '../types/timer';
import { logger } from '../telemetry/logger';

const DEFAULT_GRPC_URL = 'localhost:50051';

type GrpcKernelClient = grpc.Client & {
  scheduleTimer: grpc.handleUnaryCall<any, any>;
  cancelTimer: grpc.handleUnaryCall<any, any>;
  getTimer: grpc.handleUnaryCall<any, any>;
  listTimers: grpc.handleUnaryCall<any, any>;
  streamTimerEvents: grpc.handleServerStreamingCall<any, any>;
};

type KernelClientConstructor = new (address: string, credentials: grpc.ChannelCredentials) => GrpcKernelClient;

const loaderOptions: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

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
    throw new Error('Failed to load HorologyKernel service definition from proto file');
  }
  kernelClientCtor = ctor as KernelClientConstructor;
  return kernelClientCtor;
};

export interface TimerScheduleCommand {
  tenantId: string;
  requestedBy: string;
  name: string;
  durationMs: number;
  fireAt: string;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: TimerActionBundle;
  agentBinding?: AgentBinding;
}

export interface TimerCancelCommand {
  tenantId: string;
  timerId: string;
  requestedBy: string;
  reason?: string;
}

export interface KernelGatewayContext {
  tenantId: string;
  principalId: string;
  traceId?: string;
  headers: Record<string, string>;
}

export type KernelTimerEvent =
  | { type: 'scheduled'; timer: TimerRecord }
  | { type: 'fired'; timer: TimerRecord }
  | { type: 'cancelled'; timer: TimerRecord; reason?: string }
  | { type: 'settled'; timer: TimerRecord };

export interface KernelTimerEventEnvelope {
  envelopeId: string;
  tenantId: string;
  occurredAtIso: string;
  dedupeKey: string;
  traceId?: string;
  signature: string;
  signatureVersion: string;
  eventType: KernelTimerEvent['type'];
  event: KernelTimerEvent;
}

export interface KernelEventStream extends AsyncIterable<KernelTimerEventEnvelope> {
  close(): void;
}

export interface KernelGateway {
  schedule(command: TimerScheduleCommand, context: KernelGatewayContext): Promise<TimerRecord>;
  cancel(command: TimerCancelCommand, context: KernelGatewayContext): Promise<TimerRecord | null>;
  list(tenantId: string, context: KernelGatewayContext): Promise<TimerRecord[]>;
  get(tenantId: string, timerId: string, context: KernelGatewayContext): Promise<TimerRecord | null>;
  streamEvents(tenantId: string, context: KernelGatewayContext): KernelEventStream;
}

export class KernelNotLeaderError extends Error {
  constructor(message = 'Timer kernel is not currently the cluster leader', public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'KernelNotLeaderError';
  }
}

export class InMemoryKernelGateway implements KernelGateway {
  constructor(private readonly repository: TimerRepository = createTimerRepository()) {}

  async schedule(
    command: TimerScheduleCommand,
    _context: KernelGatewayContext,
  ): Promise<TimerRecord> {
    const timer: TimerRecord = {
      id: uuid(),
      tenantId: command.tenantId,
      requestedBy: command.requestedBy,
      name: command.name,
      durationMs: command.durationMs,
      createdAt: new Date().toISOString(),
      fireAt: command.fireAt,
      status: 'scheduled',
      metadata: cloneNullable(command.metadata),
      labels: command.labels ?? {},
      actionBundle: cloneNullable(command.actionBundle),
      agentBinding: cloneNullable(command.agentBinding),
    };
    return this.repository.save(timer);
  }

  async cancel(
    command: TimerCancelCommand,
    _context: KernelGatewayContext,
  ): Promise<TimerRecord | null> {
    const existing = await this.repository.findById(command.tenantId, command.timerId);
    if (!existing) {
      return null;
    }

    if (existing.status === 'cancelled' || existing.status === 'fired') {
      return existing;
    }

    const cancelled: TimerRecord = {
      ...existing,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelReason: command.reason,
      cancelledBy: command.requestedBy,
    };
    return this.repository.update(cancelled);
  }

  async list(tenantId: string, _context: KernelGatewayContext): Promise<TimerRecord[]> {
    return this.repository.list(tenantId);
  }

  async get(
    tenantId: string,
    timerId: string,
    _context: KernelGatewayContext,
  ): Promise<TimerRecord | null> {
    return this.repository.findById(tenantId, timerId);
  }

  streamEvents(_tenantId: string, _context: KernelGatewayContext): KernelEventStream {
    return createEmptyEventStream();
  }
}

export class GrpcKernelGateway implements KernelGateway {
  private readonly client: GrpcKernelClient;

  constructor(address: string) {
    const ClientCtor = loadKernelClientCtor();
    this.client = new ClientCtor(address, grpc.credentials.createInsecure());
  }

  async schedule(command: TimerScheduleCommand, context: KernelGatewayContext): Promise<TimerRecord> {
    const request = buildScheduleRequest(command);
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).scheduleTimer(
        request,
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(normalizeGrpcError('scheduleTimer', error));
            return;
          }
          resolve(mapTimer(response?.timer));
        },
      );
    });
  }

  async cancel(command: TimerCancelCommand, context: KernelGatewayContext): Promise<TimerRecord | null> {
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).cancelTimer(
        {
          tenantId: command.tenantId,
          timerId: command.timerId,
          requestedBy: command.requestedBy,
          reason: command.reason ?? '',
        },
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            if (isGrpcNotFound(error)) {
              resolve(null);
              return;
            }
            reject(normalizeGrpcError('cancelTimer', error));
            return;
          }
          resolve(mapTimer(response));
        },
      );
    });
  }

  async list(tenantId: string, context: KernelGatewayContext): Promise<TimerRecord[]> {
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).listTimers(
        { tenantId },
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(normalizeGrpcError('listTimers', error));
            return;
          }
          const timers: unknown[] = response?.timers ?? [];
          resolve(timers.map((timer) => mapTimer(timer)));
        },
      );
    });
  }

  async get(tenantId: string, timerId: string, context: KernelGatewayContext): Promise<TimerRecord | null> {
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).getTimer(
        { tenantId, timerId },
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            if (isGrpcNotFound(error)) {
              resolve(null);
              return;
            }
            reject(normalizeGrpcError('getTimer', error));
            return;
          }
          resolve(mapTimer(response));
        },
      );
    });
  }

  private buildMetadata(context: KernelGatewayContext): grpc.Metadata {
    const metadata = new grpc.Metadata();
    Object.entries(context.headers).forEach(([key, value]) => {
      metadata.set(key, value);
    });
    if (context.traceId) {
      metadata.set('x-trace-id', context.traceId);
    }
    metadata.set('x-principal-id', context.principalId);
    metadata.set('x-tenant-id', context.tenantId);
    return metadata;
  }

  streamEvents(tenantId: string, context: KernelGatewayContext): KernelEventStream {
    const metadata = this.buildMetadata(context);
    const request = { tenantId };
    const stream = (this.client as any).streamTimerEvents(request, metadata);
    return createGrpcEventStream(stream);
  }
}

export const createKernelGateway = (): KernelGateway => {
  const grpcUrl = process.env.KERNEL_GRPC_URL || process.env.KERNEL_GRPC_ADDR || DEFAULT_GRPC_URL;
  const mode = process.env.KERNEL_GATEWAY_MODE ?? 'grpc';

  if (mode === 'memory') {
    logger.warn('Using in-memory kernel gateway (KERNEL_GATEWAY_MODE=memory)');
    return new InMemoryKernelGateway();
  }

  return new GrpcKernelGateway(grpcUrl);
};

const createEmptyEventStream = (): KernelEventStream => ({
  async *[Symbol.asyncIterator]() {
    return;
  },
  close() {
    // no-op for tests and offline mode
  },
});

const buildScheduleRequest = (command: TimerScheduleCommand) => ({
  tenantId: command.tenantId,
  requestedBy: command.requestedBy,
  name: command.name,
  scheduleTime: { durationMs: command.durationMs },
  fireTimeIso: command.fireAt,
  metadataJson: command.metadata ? JSON.stringify(command.metadata) : '',
  labels: command.labels ?? {},
  actionBundleJson: command.actionBundle ? JSON.stringify(command.actionBundle) : '',
  agentBindingJson: command.agentBinding ? JSON.stringify(command.agentBinding) : '',
});

const mapTimer = (payload: any): TimerRecord => {
  if (!payload) {
    throw new Error('Kernel returned empty timer payload');
  }
  return {
    id: payload.id,
    tenantId: payload.tenantId,
    requestedBy: payload.requestedBy,
    name: payload.name,
    durationMs: Number(payload.durationMs ?? payload.duration_ms ?? 0),
    createdAt: payload.createdAtIso ?? payload.created_at_iso ?? new Date().toISOString(),
    fireAt: payload.fireAtIso ?? payload.fire_at_iso ?? new Date().toISOString(),
    status: mapStatus(payload.status),
    metadata: parseJson(payload.metadataJson),
    labels: convertStringMap(payload.labels),
    actionBundle: parseJson(payload.actionBundleJson) as TimerActionBundle | undefined,
    agentBinding: parseJson(payload.agentBindingJson) as AgentBinding | undefined,
    firedAt: optionalString(payload.firedAtIso),
    cancelledAt: optionalString(payload.cancelledAtIso),
    cancelReason: optionalString(payload.cancelReason),
    cancelledBy: optionalString(payload.cancelledBy),
    settledAt: optionalString(payload.settledAtIso),
    failureReason: optionalString(payload.failureReason),
    stateVersion: payload.stateVersion
      ? Number(payload.stateVersion)
      : payload.state_version !== undefined
        ? Number(payload.state_version)
        : undefined,
    jitterMs:
      payload.jitterMs !== undefined
        ? Number(payload.jitterMs)
        : payload.jitter_ms !== undefined
          ? Number(payload.jitter_ms)
          : undefined,
  };
};

const mapTimerEventEnvelope = (payload: any): KernelTimerEventEnvelope => {
  if (!payload) {
    throw new Error('Kernel stream returned empty event envelope payload');
  }
  const event = decodeTimerEvent(payload.event, payload.eventType);
  return {
    envelopeId: payload.envelopeId,
    tenantId: payload.tenantId,
    occurredAtIso: payload.occurredAtIso,
    dedupeKey: payload.dedupeKey,
    traceId: optionalString(payload.traceId),
    signature: payload.signature,
    signatureVersion: payload.signatureVersion,
    eventType: event.type,
    event,
  };
};

const decodeTimerEvent = (payload: any, explicitType?: string): KernelTimerEvent => {
  if (!payload) {
    throw new Error('Kernel stream returned empty event payload');
  }
  const scheduled = payload.scheduled ?? payload.Scheduled;
  if (scheduled) {
    return { type: 'scheduled', timer: mapTimer(extractTimerPayload(scheduled)) };
  }
  const fired = payload.fired ?? payload.Fired;
  if (fired) {
    return { type: 'fired', timer: mapTimer(extractTimerPayload(fired)) };
  }
  const cancelled = payload.cancelled ?? payload.Cancelled;
  if (cancelled) {
    return {
      type: 'cancelled',
      timer: mapTimer(extractTimerPayload(cancelled)),
      reason: optionalString(cancelled.reason),
    };
  }
  const settled = payload.settled ?? payload.Settled;
  if (settled) {
    return { type: 'settled', timer: mapTimer(extractTimerPayload(settled)) };
  }

  const discriminantSource = explicitType ?? payload.event;
  const discriminant = typeof discriminantSource === 'string' ? discriminantSource.toLowerCase() : undefined;
  if (discriminant) {
    const baseTimer = payload.timer ? mapTimer(payload.timer) : mapTimer(extractTimerPayload(payload));
    switch (discriminant) {
      case 'scheduled':
        return { type: 'scheduled', timer: baseTimer };
      case 'fired':
        return { type: 'fired', timer: baseTimer };
      case 'cancelled':
        return { type: 'cancelled', timer: baseTimer, reason: optionalString(payload.reason) };
      case 'settled':
        return { type: 'settled', timer: baseTimer };
      default:
        break;
    }
  }

  throw new Error('Unsupported kernel timer event payload shape');
};

const extractTimerPayload = (value: any): any => {
  if (!value) {
    return value;
  }
  if (value.timer) {
    return value.timer;
  }
  return value;
};

const mapStatus = (status: unknown): TimerStatus => {
  switch (status) {
    case 'scheduled':
    case 'armed':
    case 'fired':
    case 'cancelled':
    case 'failed':
    case 'settled':
      return status;
    default:
      return 'scheduled';
  }
};

const convertStringMap = (value: any): Record<string, string> | undefined => {
  if (!value) {
    return undefined;
  }
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, val]) => {
    if (typeof val === 'string') {
      acc[key] = val;
    }
    return acc;
  }, {});
};

const parseJson = (value: unknown): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.length > 0) {
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn({ error }, 'Failed to parse JSON payload from kernel');
      return undefined;
    }
  }
  return undefined;
};

const optionalString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
};

const cloneNullable = <T>(value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};

const normalizeGrpcError = (method: string, error: unknown): Error => {
  const serviceError = error as grpc.ServiceError | undefined;
  if (serviceError && typeof serviceError.code === 'number') {
    if (serviceError.code === grpc.status.FAILED_PRECONDITION) {
      const retryAfterHeader = serviceError.metadata?.get?.('retry-after-ms');
      const retryAfterMs = Array.isArray(retryAfterHeader)
        ? Number(retryAfterHeader[0]) || undefined
        : Number(retryAfterHeader) || undefined;
      return new KernelNotLeaderError(serviceError.details, retryAfterMs);
    }
    return serviceError;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(`Kernel gRPC call ${method} failed`);
};

const createGrpcEventStream = (stream: grpc.ClientReadableStream<any>): KernelEventStream => {
  let closed = false;
  let ended = false;
  let pending: (() => void) | null = null;
  let error: Error | null = null;
  const queue: KernelTimerEventEnvelope[] = [];

  const wake = () => {
    if (pending) {
      pending();
      pending = null;
    }
  };

  stream.on('data', (payload) => {
    try {
      queue.push(mapTimerEventEnvelope(payload));
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      logger.error({ error: errorObj }, 'Failed to decode timer event envelope from kernel stream');
    }
    wake();
  });

  stream.on('error', (err) => {
    if (!ended) {
      error = normalizeGrpcError('streamTimerEvents', err);
    }
    wake();
  });

  stream.on('end', () => {
    ended = true;
    wake();
  });

  const iterator = async function* (): AsyncGenerator<KernelTimerEventEnvelope> {
    try {
      while (true) {
        if (queue.length === 0) {
          if (error) {
            throw error;
          }
          if (ended) {
            return;
          }
          await new Promise<void>((resolve) => {
            pending = resolve;
          });
          continue;
        }
        const next = queue.shift();
        if (next) {
          yield next;
        }
      }
    } finally {
      if (!closed) {
        closed = true;
        stream.cancel();
      }
    }
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield* iterator();
    },
    close() {
      if (!closed) {
        closed = true;
        stream.cancel();
      }
    },
  };
};

const isGrpcNotFound = (error: unknown): boolean => {
  return Boolean((error as grpc.ServiceError)?.code === grpc.status.NOT_FOUND);
};
