import path from 'node:path';
import { promisify } from 'node:util';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { v4 as uuid } from 'uuid';

import { InMemoryTimerRepository } from '../store/inMemoryTimerRepository';
import {
  TimerRecord,
  TimerActionBundle,
  AgentBinding,
  TimerStatus,
  TimerExecutionResult,
  TimerExecutionError,
  TimerActionResult,
} from '../types/timer';
import { logger } from '../telemetry/logger';

const DEFAULT_GRPC_URL = 'localhost:50051';

type GrpcKernelClient = grpc.Client & {
  scheduleTimer: grpc.handleUnaryCall<any, any>;
  cancelTimer: grpc.handleUnaryCall<any, any>;
  getTimer: grpc.handleUnaryCall<any, any>;
  listTimers: grpc.handleUnaryCall<any, any>;
};

type ScheduleTimerMethod = (request: any) => Promise<any>;
type CancelTimerMethod = (request: any) => Promise<any>;
type GetTimerMethod = (request: any) => Promise<any>;
type ListTimersMethod = (request: any) => Promise<any>;
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
  schedule(command: TimerScheduleCommand): Promise<TimerRecord>;
  cancel(command: TimerCancelCommand): Promise<TimerRecord | null>;
  list(tenantId: string): Promise<TimerRecord[]>;
  get(tenantId: string, timerId: string): Promise<TimerRecord | null>;
}

export class InMemoryKernelGateway implements KernelGateway {
  constructor(private readonly repository = new InMemoryTimerRepository()) {}

  async schedule(command: TimerScheduleCommand): Promise<TimerRecord> {
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

  async cancel(command: TimerCancelCommand): Promise<TimerRecord | null> {
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

  async list(tenantId: string): Promise<TimerRecord[]> {
    return this.repository.list(tenantId);
  }

  async get(tenantId: string, timerId: string): Promise<TimerRecord | null> {
    return this.repository.findById(tenantId, timerId);
  }
}

export class GrpcKernelGateway implements KernelGateway {
  private readonly client: GrpcKernelClient;
  private readonly scheduleTimer: ScheduleTimerMethod;
  private readonly cancelTimer: CancelTimerMethod;
  private readonly getTimer: GetTimerMethod;
  private readonly listTimers: ListTimersMethod;

  constructor(address: string) {
    const ClientCtor = loadKernelClientCtor();
    this.client = new ClientCtor(address, grpc.credentials.createInsecure());
    this.scheduleTimer = promisify(this.client.scheduleTimer.bind(this.client));
    this.cancelTimer = promisify(this.client.cancelTimer.bind(this.client));
    this.getTimer = promisify(this.client.getTimer.bind(this.client));
    this.listTimers = promisify(this.client.listTimers.bind(this.client));
  }

  async schedule(command: TimerScheduleCommand): Promise<TimerRecord> {
    try {
      const request = buildScheduleRequest(command);
      const response = await this.scheduleTimer(request);
      return mapTimer(response?.timer);
    } catch (error) {
      throw normalizeGrpcError('scheduleTimer', error);
    }
  }

  async cancel(command: TimerCancelCommand): Promise<TimerRecord | null> {
    try {
      const response = await this.cancelTimer({
        tenantId: command.tenantId,
        timerId: command.timerId,
        requestedBy: command.requestedBy,
        reason: command.reason ?? '',
      });
      return mapTimer(response);
    } catch (error) {
      if (isGrpcNotFound(error)) {
        return null;
      }
      throw normalizeGrpcError('cancelTimer', error);
    }
  }

  async list(tenantId: string): Promise<TimerRecord[]> {
    try {
      const response = await this.listTimers({ tenantId });
      const timers: unknown[] = response?.timers ?? [];
      return timers.map((timer) => mapTimer(timer));
    } catch (error) {
      throw normalizeGrpcError('listTimers', error);
    }
  }

  async get(tenantId: string, timerId: string): Promise<TimerRecord | null> {
    try {
      const response = await this.getTimer({ tenantId, timerId });
      return mapTimer(response);
    } catch (error) {
      if (isGrpcNotFound(error)) {
        return null;
      }
      throw normalizeGrpcError('getTimer', error);
    }
  }
}

export const createKernelGateway = (): KernelGateway => {
  const grpcUrl = process.env.KERNEL_GRPC_URL || process.env.KERNEL_GRPC_ADDR || DEFAULT_GRPC_URL;
  const mode = process.env.KERNEL_GATEWAY_MODE ?? 'grpc';

  if (mode === 'memory') {
    logger.warn('Using in-memory kernel gateway (KERNEL_GATEWAY_MODE=memory)');
    return new InMemoryKernelGateway();
  }

  try {
    const gateway = new GrpcKernelGateway(grpcUrl);
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
    executionResult: convertExecutionResult(payload.executionResult),
    executionError: convertExecutionError(payload.executionError),
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

const convertExecutionResult = (payload: any): TimerExecutionResult | undefined => {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const actions = Array.isArray(payload.actions)
    ? (payload.actions as unknown[])
        .map((raw) => convertActionResult(raw))
        .filter((action): action is TimerActionResult => action !== null)
    : [];

  const completedAtIso = optionalString(payload.completedAtIso);

  if (actions.length === 0 && !completedAtIso) {
    return undefined;
  }

  return {
    actions,
    completedAtIso,
  };
};

const convertActionResult = (payload: unknown): TimerActionResult | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.actionId !== 'string' || record.actionId.length === 0) {
    return null;
  }

  return {
    actionId: record.actionId,
    success: Boolean(record.success),
    output: optionalString(record.output as string | undefined),
    metadata: parseJson(record.metadataJson as string | undefined),
  };
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
