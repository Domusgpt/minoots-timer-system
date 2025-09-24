import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import {
  AgentBinding,
  TimerAction,
  TimerActionBundle,
  TimerRecord,
  TimerStatus,
} from '../types/timer';
import {
  KernelCancelRequest,
  KernelGateway,
  KernelScheduleRequest,
} from './kernelGateway';

type GrpcClient = grpc.Client & {
  scheduleTimer: (request: unknown, callback: grpc.requestCallback<any>) => void;
  cancelTimer: (request: unknown, callback: grpc.requestCallback<any>) => void;
  getTimer: (request: unknown, callback: grpc.requestCallback<any>) => void;
  listTimers: (request: unknown, callback: grpc.requestCallback<any>) => void;
};

const PROTO_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'proto',
  'timer.proto',
);

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

const STATUS_MAP: Record<string, TimerStatus> = {
  TIMER_STATUS_UNSPECIFIED: 'scheduled',
  TIMER_STATUS_SCHEDULED: 'scheduled',
  TIMER_STATUS_ARMED: 'armed',
  TIMER_STATUS_FIRED: 'fired',
  TIMER_STATUS_CANCELLED: 'cancelled',
  TIMER_STATUS_FAILED: 'failed',
};

const toTimestamp = (iso?: string) => {
  if (!iso) {
    return undefined;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  const seconds = Math.floor(date.getTime() / 1000);
  const nanos = (date.getTime() % 1000) * 1_000_000;
  return { seconds, nanos };
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

const decodeStruct = (struct?: { fields?: Record<string, any> }): Record<string, unknown> | undefined => {
  if (!struct || typeof struct !== 'object' || !('fields' in struct)) {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(struct.fields ?? {})) {
    output[key] = decodeValue(value as any);
  }
  return output;
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
      return decodeStruct(typed.structValue as { fields?: Record<string, unknown> });
    default:
      return null;
  }
};

const encodeStruct = (value?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }
  const fields: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    fields[key] = encodeValue(entry);
  }
  return { fields };
};

const encodeValue = (value: unknown): Record<string, unknown> => {
  if (value === null || value === undefined) {
    return { kind: 'nullValue', nullValue: 'NULL_VALUE' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolValue', boolValue: value };
  }
  if (typeof value === 'number') {
    return { kind: 'numberValue', numberValue: value };
  }
  if (typeof value === 'string') {
    return { kind: 'stringValue', stringValue: value };
  }
  if (Array.isArray(value)) {
    return {
      kind: 'listValue',
      listValue: { values: value.map((item) => encodeValue(item)) },
    };
  }
  if (typeof value === 'object') {
    return {
      kind: 'structValue',
      structValue: encodeStruct(value as Record<string, unknown>),
    };
  }
  return { kind: 'stringValue', stringValue: String(value) };
};

const decodeAction = (action: any): TimerAction => {
  const parameters = decodeStruct(action.parameters) ?? {};
  const escalation = action.escalation
    ? {
        afterAttempts: Number(action.escalation.afterAttempts ?? 1),
        escalatesTo: action.escalation.escalatesTo
          ? decodeAction(action.escalation.escalatesTo)
          : undefined,
      }
    : undefined;
  return {
    id: action.id,
    kind: action.kind,
    parameters,
    escalation,
  };
};

const encodeAction = (action: TimerAction): Record<string, unknown> => {
  return {
    id: action.id,
    kind: action.kind,
    parameters: encodeStruct(action.parameters),
    escalation: action.escalation
      ? {
          afterAttempts: action.escalation.afterAttempts,
          escalatesTo: action.escalation.escalatesTo
            ? encodeAction(action.escalation.escalatesTo)
            : undefined,
        }
      : undefined,
  };
};

const decodeActionBundle = (bundle: any): TimerActionBundle | undefined => {
  if (!bundle) {
    return undefined;
  }
  const actions = Array.isArray(bundle.actions)
    ? bundle.actions.map((item: any) => decodeAction(item))
    : [];
  const retryPolicy = bundle.retryPolicy
    ? {
        maxAttempts: Number(bundle.retryPolicy.maxAttempts ?? 1),
        backoffInitialMs: Number(bundle.retryPolicy.backoffInitialMs ?? 1000),
        backoffMultiplier: Number(bundle.retryPolicy.backoffMultiplier ?? 2),
      }
    : undefined;
  return {
    actions,
    concurrency: Number(bundle.concurrency ?? 1),
    retryPolicy,
  };
};

const encodeActionBundle = (bundle?: TimerActionBundle): Record<string, unknown> | undefined => {
  if (!bundle) {
    return undefined;
  }
  return {
    actions: bundle.actions.map((action) => encodeAction(action)),
    concurrency: bundle.concurrency,
    retryPolicy: bundle.retryPolicy
      ? {
          maxAttempts: bundle.retryPolicy.maxAttempts,
          backoffInitialMs: bundle.retryPolicy.backoffInitialMs,
          backoffMultiplier: bundle.retryPolicy.backoffMultiplier,
        }
      : undefined,
  };
};

const decodeAgentBinding = (binding: any): AgentBinding | undefined => {
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

const encodeAgentBinding = (binding?: AgentBinding): Record<string, unknown> | undefined => {
  if (!binding) {
    return undefined;
  }
  return {
    adapter: binding.adapter,
    target: binding.target,
    payloadTemplate: encodeStruct(binding.payloadTemplate),
    acknowledgementTimeoutMs: binding.acknowledgementTimeoutMs,
  };
};

const mapTimer = (timer: any): TimerRecord => {
  const statusKey = typeof timer.status === 'string' ? timer.status : '';
  const status = STATUS_MAP[statusKey] ?? 'scheduled';
  const metadata = decodeStruct(timer.metadata);
  const actionBundle = decodeActionBundle(timer.actionBundle);
  const agentBinding = decodeAgentBinding(timer.agentBinding);

  return {
    id: timer.id,
    tenantId: timer.tenantId,
    requestedBy: timer.requestedBy,
    name: timer.name,
    status,
    durationMs: Number(timer.durationMs ?? 0),
    createdAt: fromTimestamp(timer.createdAt) ?? new Date().toISOString(),
    fireAt: fromTimestamp(timer.fireAt) ?? new Date().toISOString(),
    metadata: metadata ?? undefined,
    labels: timer.labels ?? {},
    actionBundle: actionBundle ?? undefined,
    agentBinding: agentBinding ?? undefined,
    firedAt: fromTimestamp(timer.firedAt),
    cancelledAt: fromTimestamp(timer.cancelledAt),
    cancelReason: timer.cancelReason ? String(timer.cancelReason) : undefined,
    cancelledBy: timer.cancelledBy ? String(timer.cancelledBy) : undefined,
  };
};

const isNotFound = (error: unknown): boolean => {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as grpc.ServiceError).code === grpc.status.NOT_FOUND,
  );
};

export class GrpcKernelGateway implements KernelGateway {
  private readonly client: GrpcClient;

  constructor(address: string) {
    this.client = new KernelService(address, grpc.credentials.createInsecure());
  }

  private callUnary<TResponse>(method: keyof GrpcClient, payload: unknown): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      const handler = this.client[method] as (request: unknown, callback: grpc.requestCallback<TResponse>) => void;
      handler.call(this.client, payload, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response as TResponse);
      });
    });
  }

  async schedule(request: KernelScheduleRequest): Promise<TimerRecord> {
    const payload = {
      tenantId: request.tenantId,
      requestedBy: request.requestedBy,
      name: request.name ?? '',
      durationMs: request.durationMs ?? 0,
      fireTime: toTimestamp(request.fireAt),
      metadata: encodeStruct(request.metadata),
      labels: request.labels ?? {},
      actionBundle: encodeActionBundle(request.actionBundle),
      agentBinding: encodeAgentBinding(request.agentBinding),
    };
    const response = await this.callUnary<{ timer: any }>('scheduleTimer', payload);
    if (!response?.timer) {
      throw new Error('Kernel did not return a timer for schedule request');
    }
    return mapTimer(response.timer);
  }

  async cancel(request: KernelCancelRequest): Promise<TimerRecord | null> {
    const payload = {
      tenantId: request.tenantId,
      timerId: request.timerId,
      reason: request.reason ?? '',
      requestedBy: request.requestedBy,
    };
    try {
      const response = await this.callUnary<any>('cancelTimer', payload);
      return mapTimer(response);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async get(tenantId: string, timerId: string): Promise<TimerRecord | null> {
    try {
      const response = await this.callUnary<any>('getTimer', { tenantId, timerId });
      return mapTimer(response);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async list(tenantId: string): Promise<TimerRecord[]> {
    const response = await this.callUnary<{ timers?: any[] }>('listTimers', {
      tenantId,
      pageSize: 0,
      pageToken: '',
      statuses: [],
    });
    const timers = Array.isArray(response?.timers) ? response.timers : [];
    return timers.map((timer) => mapTimer(timer));
  }
}
