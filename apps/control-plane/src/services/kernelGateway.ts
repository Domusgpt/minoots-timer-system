import path from 'node:path';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { v4 as uuid } from 'uuid';

import { TimerRepository } from '../store/timerRepository';
import { createTimerRepository } from '../store/createTimerRepository';
import {
  TimerRecord,
  TimerActionBundle,
  AgentBinding,
  TimerStatus,
  TimerGraphDefinition,
  JitterPolicy,
  TimerEventEnvelope,
  TimerEvent,
} from '../types/timer';
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
  temporalGraph?: TimerGraphDefinition;
  jitterPolicy?: JitterPolicy;
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

export interface TimerEventStreamOptions {
  tenantId: string;
  topics?: string[];
}

export interface TimerEventHandlers {
  onEvent: (envelope: TimerEventEnvelope) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export interface TimerEventSubscription {
  close(): void;
}

export interface KernelGateway {
  schedule(command: TimerScheduleCommand, context: KernelGatewayContext): Promise<TimerRecord>;
  cancel(command: TimerCancelCommand, context: KernelGatewayContext): Promise<TimerRecord | null>;
  list(tenantId: string, context: KernelGatewayContext): Promise<TimerRecord[]>;
  get(tenantId: string, timerId: string, context: KernelGatewayContext): Promise<TimerRecord | null>;
  streamEvents(
    options: TimerEventStreamOptions,
    context: KernelGatewayContext,
    handlers: TimerEventHandlers,
  ): TimerEventSubscription;
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
      temporalGraph: cloneNullable(command.temporalGraph),
      graphRootId: undefined,
      graphNodeId: undefined,
      jitterPolicy: cloneNullable(command.jitterPolicy),
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

  streamEvents(
    _options: TimerEventStreamOptions,
    _context: KernelGatewayContext,
    handlers: TimerEventHandlers,
  ): TimerEventSubscription {
    const error = new Error('Timer event streaming is not supported by the in-memory gateway');
    setImmediate(() => handlers.onError?.(error));
    return {
      close: () => undefined,
    };
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

  streamEvents(
    options: TimerEventStreamOptions,
    context: KernelGatewayContext,
    handlers: TimerEventHandlers,
  ): TimerEventSubscription {
    const metadata = this.buildMetadata(context);
    const request = {
      tenantId: options.tenantId,
      topics: options.topics ?? [],
    };
    const call = (this.client as any).streamTimerEvents(request, metadata);
    call.on('data', (payload: any) => {
      try {
        handlers.onEvent(mapTimerEventEnvelope(payload));
      } catch (error) {
        handlers.onError?.(error as Error);
      }
    });
    call.on('error', (error: grpc.ServiceError) => {
      handlers.onError?.(normalizeGrpcError('streamTimerEvents', error));
    });
    call.on('end', () => {
      handlers.onClose?.();
    });
    return {
      close: () => {
        call.cancel();
      },
    };
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
  temporalGraphJson: command.temporalGraph ? JSON.stringify(command.temporalGraph) : '',
  jitterPolicyJson: command.jitterPolicy ? JSON.stringify(command.jitterPolicy) : '',
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
    temporalGraph: parseGraphDefinition(payload.temporalGraphJson ?? payload.temporal_graph_json),
    graphRootId: optionalString(payload.graphRootId ?? payload.graph_root_id),
    graphNodeId: optionalString(payload.graphNodeId ?? payload.graph_node_id),
    jitterPolicy: parseJitterPolicy(payload.jitterPolicyJson ?? payload.jitter_policy_json),
  };
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

const parseJsonValue = <T>(value: unknown): T | undefined => {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn({ error }, 'Failed to parse JSON payload from kernel');
      return undefined;
    }
  }
  return undefined;
};

const parseGraphDefinition = (value: unknown): TimerGraphDefinition | undefined => {
  return parseJsonValue<TimerGraphDefinition>(value);
};

const parseJitterPolicy = (value: unknown): JitterPolicy | undefined => {
  return parseJsonValue<JitterPolicy>(value);
};

const mapTimerEventEnvelope = (payload: any): TimerEventEnvelope => {
  if (!payload) {
    throw new Error('Kernel returned empty timer event envelope');
  }
  const event = mapTimerEvent(payload.event ?? payload);
  return {
    envelopeId: payload.envelopeId ?? payload.envelope_id,
    tenantId: payload.tenantId ?? payload.tenant_id,
    occurredAtIso: payload.occurredAtIso ?? payload.occurred_at_iso,
    dedupeKey: payload.dedupeKey ?? payload.dedupe_key,
    traceId: optionalString(payload.traceId ?? payload.trace_id),
    signature: payload.signature,
    signatureVersion: payload.signatureVersion ?? payload.signature_version,
    eventType: event.type,
    event,
  };
};

const mapTimerEvent = (payload: any): TimerEvent => {
  const event = payload?.event ?? payload;
  if (!event) {
    throw new Error('Timer event is missing payload');
  }
  if (event.scheduled?.timer) {
    return { type: 'scheduled', data: mapTimer(event.scheduled.timer) };
  }
  if (event.fired?.timer) {
    return { type: 'fired', data: mapTimer(event.fired.timer) };
  }
  if (event.cancelled?.timer) {
    return {
      type: 'cancelled',
      data: { timer: mapTimer(event.cancelled.timer), reason: optionalString(event.cancelled.reason) },
    };
  }
  if (event.settled?.timer) {
    return { type: 'settled', data: mapTimer(event.settled.timer) };
  }
  throw new Error('Unsupported timer event payload');
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

const isGrpcNotFound = (error: unknown): boolean => {
  return Boolean((error as grpc.ServiceError)?.code === grpc.status.NOT_FOUND);
};
