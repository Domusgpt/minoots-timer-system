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

export interface KernelGateway {
  schedule(command: TimerScheduleCommand, context: KernelGatewayContext): Promise<TimerRecord>;
  cancel(command: TimerCancelCommand, context: KernelGatewayContext): Promise<TimerRecord | null>;
  list(tenantId: string, context: KernelGatewayContext): Promise<TimerRecord[]>;
  get(tenantId: string, timerId: string, context: KernelGatewayContext): Promise<TimerRecord | null>;
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
      this.client.scheduleTimer(request, metadata, (error, response) => {
        if (error) {
          reject(normalizeGrpcError('scheduleTimer', error));
          return;
        }
        resolve(mapTimer(response?.timer));
      });
    });
  }

  async cancel(command: TimerCancelCommand, context: KernelGatewayContext): Promise<TimerRecord | null> {
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      this.client.cancelTimer(
        {
          tenantId: command.tenantId,
          timerId: command.timerId,
          requestedBy: command.requestedBy,
          reason: command.reason ?? '',
        },
        metadata,
        (error, response) => {
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
      this.client.listTimers(
        { tenantId },
        metadata,
        (error, response) => {
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
      this.client.getTimer(
        { tenantId, timerId },
        metadata,
        (error, response) => {
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

const normalizeGrpcError = (method: string, error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(`Kernel gRPC call ${method} failed`);
};

const isGrpcNotFound = (error: unknown): boolean => {
  return Boolean((error as grpc.ServiceError)?.code === grpc.status.NOT_FOUND);
};
