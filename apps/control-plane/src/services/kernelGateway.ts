import path from 'node:path';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { v4 as uuid } from 'uuid';

import { TimerRepository } from '../store/timerRepository';
import { createTimerRepository } from '../store/createTimerRepository';
import { TimerRecord, TimerActionBundle, AgentBinding, TimerStatus } from '../types/timer';
import { AuthContext } from '../types/auth';
import { signKernelMetadata } from '../utils/signature';
import { logger } from '../telemetry/logger';

const DEFAULT_GRPC_URL = 'localhost:50051';

export interface TimerEventStreamCommand {
  tenantId: string;
  topics?: string[];
}

export type KernelEventStream = grpc.ClientReadableStream<any>;

type GrpcUnaryMethod = (
  request: any,
  metadata: grpc.Metadata,
  callback: grpc.requestCallback<any>,
) => grpc.ClientUnaryCall;

type GrpcKernelClient = grpc.Client & {
  scheduleTimer: GrpcUnaryMethod;
  cancelTimer: GrpcUnaryMethod;
  getTimer: GrpcUnaryMethod;
  listTimers: GrpcUnaryMethod;
  streamTimerEvents: (
    request: any,
    metadata: grpc.Metadata,
  ) => grpc.ClientReadableStream<any>;
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

export interface KernelGateway {
  schedule(command: TimerScheduleCommand, context: AuthContext): Promise<TimerRecord>;
  cancel(command: TimerCancelCommand, context: AuthContext): Promise<TimerRecord | null>;
  list(tenantId: string, context: AuthContext): Promise<TimerRecord[]>;
  get(tenantId: string, timerId: string, context: AuthContext): Promise<TimerRecord | null>;
  streamEvents(command: TimerEventStreamCommand, context: AuthContext): KernelEventStream;
}

export class InMemoryKernelGateway implements KernelGateway {
  constructor(private readonly repository: TimerRepository = createTimerRepository()) {}

  async schedule(command: TimerScheduleCommand, _context: AuthContext): Promise<TimerRecord> {
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

  async cancel(command: TimerCancelCommand, _context: AuthContext): Promise<TimerRecord | null> {
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

  async list(tenantId: string, _context: AuthContext): Promise<TimerRecord[]> {
    return this.repository.list(tenantId);
  }

  async get(tenantId: string, timerId: string, _context: AuthContext): Promise<TimerRecord | null> {
    return this.repository.findById(tenantId, timerId);
  }

  streamEvents(_command: TimerEventStreamCommand, _context: AuthContext): KernelEventStream {
    throw new Error('Streaming is not supported in memory mode');
  }
}

export class GrpcKernelGateway implements KernelGateway {
  private readonly client: GrpcKernelClient;
  private readonly scheduleTimerMethod: GrpcUnaryMethod;
  private readonly cancelTimerMethod: GrpcUnaryMethod;
  private readonly getTimerMethod: GrpcUnaryMethod;
  private readonly listTimersMethod: GrpcUnaryMethod;

  constructor(address: string, private readonly signingSecret: string) {
    const ClientCtor = loadKernelClientCtor();
    this.client = new ClientCtor(address, grpc.credentials.createInsecure());
    this.scheduleTimerMethod = this.client.scheduleTimer.bind(this.client);
    this.cancelTimerMethod = this.client.cancelTimer.bind(this.client);
    this.getTimerMethod = this.client.getTimer.bind(this.client);
    this.listTimersMethod = this.client.listTimers.bind(this.client);
  }

  async schedule(command: TimerScheduleCommand, context: AuthContext): Promise<TimerRecord> {
    try {
      const request = buildScheduleRequest(command);
      const metadata = this.createMetadata(context, { action: 'schedule', timerName: command.name });
      const response = await this.invokeUnary(this.scheduleTimerMethod, request, metadata);
      return mapTimer(response?.timer);
    } catch (error) {
      throw normalizeGrpcError('scheduleTimer', error);
    }
  }

  async cancel(command: TimerCancelCommand, context: AuthContext): Promise<TimerRecord | null> {
    try {
      const metadata = this.createMetadata(context, { action: 'cancel', timerId: command.timerId });
      const response = await this.invokeUnary(this.cancelTimerMethod, {
        tenantId: command.tenantId,
        timerId: command.timerId,
        requestedBy: command.requestedBy,
        reason: command.reason ?? '',
      }, metadata);
      return mapTimer(response);
    } catch (error) {
      if (isGrpcNotFound(error)) {
        return null;
      }
      throw normalizeGrpcError('cancelTimer', error);
    }
  }

  async list(tenantId: string, context: AuthContext): Promise<TimerRecord[]> {
    try {
      const metadata = this.createMetadata(context, { action: 'list', tenantId });
      const response = await this.invokeUnary(this.listTimersMethod, { tenantId }, metadata);
      const timers: unknown[] = response?.timers ?? [];
      return timers.map((timer) => mapTimer(timer));
    } catch (error) {
      throw normalizeGrpcError('listTimers', error);
    }
  }

  async get(tenantId: string, timerId: string, context: AuthContext): Promise<TimerRecord | null> {
    try {
      const metadata = this.createMetadata(context, { action: 'get', timerId });
      const response = await this.invokeUnary(this.getTimerMethod, { tenantId, timerId }, metadata);
      return mapTimer(response);
    } catch (error) {
      if (isGrpcNotFound(error)) {
        return null;
      }
      throw normalizeGrpcError('getTimer', error);
    }
  }

  streamEvents(command: TimerEventStreamCommand, context: AuthContext): KernelEventStream {
    const metadata = this.createMetadata(context, { action: 'stream', tenantId: command.tenantId });
    const request = {
      tenantId: command.tenantId,
      topics: command.topics ?? [],
    };
    return this.client.streamTimerEvents(request, metadata);
  }

  private invokeUnary(method: GrpcUnaryMethod, request: any, metadata: grpc.Metadata): Promise<any> {
    return new Promise((resolve, reject) => {
      method(request, metadata, (err, response) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
    });
  }

  private createMetadata(context: AuthContext, payload: Record<string, unknown>): grpc.Metadata {
    const metadata = new grpc.Metadata();
    metadata.set('x-tenant-id', context.tenantId);
    metadata.set('x-principal-id', context.principalId);
    metadata.set('x-key-id', context.keyId);
    metadata.set('x-roles', context.roles.join(','));
    metadata.set('x-request-id', context.requestId);
    if (context.traceId) {
      metadata.set('x-trace-id', context.traceId);
    }
    const envelope = signKernelMetadata(this.signingSecret, context, payload);
    metadata.set('x-signed-at', envelope.issuedAt);
    metadata.set('x-signature', envelope.signature);
    return metadata;
  }
}

export const createKernelGateway = (options?: { signingSecret?: string }): KernelGateway => {
  const grpcUrl = process.env.KERNEL_GRPC_URL || process.env.KERNEL_GRPC_ADDR || DEFAULT_GRPC_URL;
  const mode = process.env.KERNEL_GATEWAY_MODE ?? 'grpc';
  const signingSecret = options?.signingSecret ?? process.env.POLICY_SIGNING_SECRET ?? 'development-secret';

  if (mode === 'memory') {
    logger.warn('Using in-memory kernel gateway (KERNEL_GATEWAY_MODE=memory)');
    return new InMemoryKernelGateway();
  }

  try {
    const gateway = new GrpcKernelGateway(grpcUrl, signingSecret);
    logger.info({ grpcUrl }, 'Connected to horology kernel via gRPC');
    return gateway;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize gRPC kernel gateway, falling back to memory');
    return new InMemoryKernelGateway();
  }
};

const buildScheduleRequest = (command: TimerScheduleCommand) => {
  const scheduleTime = command.fireAt
    ? { fireTimeIso: command.fireAt }
    : { durationMs: command.durationMs };

  return {
    tenantId: command.tenantId,
    requestedBy: command.requestedBy,
    name: command.name,
    scheduleTime,
    labels: command.labels ?? {},
    metadataJson: toJsonString(command.metadata),
    actionBundleJson: toJsonString(command.actionBundle),
    agentBindingJson: toJsonString(command.agentBinding),
  };
};

const mapTimer = (payload: any): TimerRecord => {
  if (!payload) {
    throw new Error('Horology kernel did not return a timer payload');
  }

  const status = mapStatus(payload.status);
  const record: TimerRecord = {
    id: payload.id,
    tenantId: payload.tenantId,
    requestedBy: payload.requestedBy,
    name: payload.name,
    status,
    createdAt: payload.createdAtIso ?? new Date().toISOString(),
    fireAt: payload.fireAtIso ?? new Date().toISOString(),
    firedAt: optionalString(payload.firedAtIso),
    cancelledAt: optionalString(payload.cancelledAtIso),
    cancelReason: optionalString(payload.cancelReason),
    cancelledBy: optionalString(payload.cancelledBy),
    durationMs: Number(payload.durationMs ?? 0),
    metadata: parseJson(payload.metadataJson),
    labels: convertStringMap(payload.labels) ?? {},
    actionBundle: parseJson(payload.actionBundleJson) as TimerActionBundle | undefined,
    agentBinding: parseJson(payload.agentBindingJson) as AgentBinding | undefined,
  };

  return record;
};

const mapStatus = (status: unknown): TimerStatus => {
  const value = typeof status === 'string' ? status : String(status ?? '');
  switch (value) {
    case 'TIMER_STATUS_SCHEDULED':
    case 'scheduled':
    case '1':
      return 'scheduled';
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
    case 'TIMER_STATUS_UNSPECIFIED':
    case '0':
    default:
      return 'scheduled';
  }
};

const toJsonString = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    logger.error({ error }, 'Failed to serialize payload to JSON');
    return '';
  }
};

const parseJson = <T>(value?: string): T | undefined => {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error({ error, value }, 'Failed to parse JSON payload from kernel');
    return undefined;
  }
};

const convertStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, raw]) => {
      if (typeof raw === 'string') {
        acc[key] = raw;
      } else if (raw != null) {
        acc[key] = String(raw);
      }
      return acc;
    },
    {},
  );
  return Object.keys(entries).length > 0 ? entries : undefined;
};

const cloneNullable = <T>(value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};

const optionalString = (value?: string): string | undefined => {
  if (!value || value.length === 0) {
    return undefined;
  }
  return value;
};

const isGrpcNotFound = (error: unknown): boolean => {
  return Boolean(typeof error === 'object' && error !== null && (error as { code?: number }).code === grpc.status.NOT_FOUND);
};

const normalizeGrpcError = (method: string, error: unknown): Error => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const err = error as grpc.ServiceError;
    return new Error(`Kernel gRPC ${method} failed: ${err.message}`);
  }
  return new Error(`Kernel gRPC ${method} failed: ${String(error)}`);
};
