import path from 'node:path';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

import { KernelGateway } from './kernelGateway';
import {
  AgentBinding,
  TimerAction,
  TimerActionBundle,
  TimerRecord,
  TimerStatus,
} from '../types/timer';

interface ProtoTimestamp {
  seconds: string | number;
  nanos: number;
}

interface ProtoListValue {
  values: ProtoValue[];
}

interface ProtoStruct {
  fields: Record<string, ProtoValue>;
}

interface ProtoValue {
  nullValue?: number | string;
  numberValue?: number | string;
  stringValue?: string;
  boolValue?: boolean;
  structValue?: ProtoStruct;
  listValue?: ProtoListValue;
}

type HorologyKernelClient = grpc.Client & {
  scheduleTimer(
    request: unknown,
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
  cancelTimer(
    request: unknown,
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
  getTimer(
    request: unknown,
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
  listTimers(
    request: unknown,
    callback: (err: grpc.ServiceError | null, response: any) => void,
  ): void;
};

const STATUS_MAP: Record<string, TimerStatus> = {
  TIMER_STATUS_SCHEDULED: 'scheduled',
  TIMER_STATUS_ARMED: 'armed',
  TIMER_STATUS_FIRED: 'fired',
  TIMER_STATUS_CANCELLED: 'cancelled',
  TIMER_STATUS_FAILED: 'failed',
};

const DEFAULT_PROTO_PATH = path.resolve(
  __dirname,
  '../../../../proto/timer.proto',
);

export class GrpcKernelGateway implements KernelGateway {
  private readonly client: HorologyKernelClient;

  constructor(address: string, protoPath: string = DEFAULT_PROTO_PATH) {
    const packageDefinition = protoLoader.loadSync(protoPath, {
      enums: String,
      longs: String,
      defaults: false,
      oneofs: true,
    });
    const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const service = descriptor.minoots.timer.v1.HorologyKernel;
    this.client = new service(address, grpc.credentials.createInsecure());
  }

  async schedule(timer: TimerRecord): Promise<TimerRecord | null> {
    const request = timerRecordToScheduleRequest(timer);
    const response = await this.unary<any>('scheduleTimer', request);
    if (!response?.timer) {
      throw new Error('Horology kernel returned an empty schedule response');
    }
    return timerFromProto(response.timer);
  }

  async cancel(
    tenantId: string,
    timerId: string,
    reason?: string,
    cancelledBy?: string,
  ): Promise<TimerRecord | null> {
    try {
      const response = await this.unary<any>('cancelTimer', {
        tenantId,
        timerId,
        reason: reason ?? '',
        cancelledBy: cancelledBy ?? '',
      });
      return timerFromProto(response);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async get(tenantId: string, timerId: string): Promise<TimerRecord | null> {
    try {
      const response = await this.unary<any>('getTimer', { tenantId, timerId });
      return timerFromProto(response);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async list(tenantId: string): Promise<TimerRecord[]> {
    const response = await this.unary<any>('listTimers', {
      tenantId,
      pageSize: 0,
      statuses: [],
    });
    const timers: TimerRecord[] = (response?.timers ?? []).map((timer: any) =>
      timerFromProto(timer),
    );
    return timers;
  }

  private unary<TResponse>(
    method: keyof HorologyKernelClient,
    request: unknown,
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const fn = this.client[method] as unknown as (
        req: unknown,
        callback: (err: grpc.ServiceError | null, res: TResponse) => void,
      ) => void;
      fn.call(this.client, request, (err, res) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    });
  }
}

const isNotFoundError = (error: unknown): boolean =>
  Boolean(
    (error as grpc.ServiceError)?.code !== undefined &&
      (error as grpc.ServiceError).code === grpc.status.NOT_FOUND,
  );

const timerRecordToScheduleRequest = (timer: TimerRecord) => {
  const fireAtTimestamp = toTimestamp(timer.fireAt);
  return {
    tenantId: timer.tenantId,
    requestedBy: timer.requestedBy,
    name: timer.name,
    durationMs: timer.durationMs.toString(),
    fireTime: fireAtTimestamp,
    labels: timer.labels ?? {},
    metadata: timer.metadata
      ? jsonToProtoStruct(asRecord(timer.metadata))
      : undefined,
    actionBundle: timer.actionBundle
      ? actionBundleToProto(timer.actionBundle)
      : undefined,
    agentBinding: timer.agentBinding
      ? agentBindingToProto(timer.agentBinding)
      : undefined,
    clientTimerId: timer.id,
  };
};

const timerFromProto = (timer: any): TimerRecord => {
  const status = STATUS_MAP[timer.status as string] ?? 'scheduled';
  return {
    id: timer.id,
    tenantId: timer.tenantId,
    requestedBy: timer.requestedBy,
    name: timer.name,
    status,
    durationMs: Number(timer.durationMs ?? 0),
    createdAt: fromTimestamp(timer.createdAt) ?? new Date().toISOString(),
    fireAt: fromTimestamp(timer.fireAt) ?? new Date().toISOString(),
    metadata: timer.metadata ? protoStructToJson(timer.metadata) : undefined,
    labels: timer.labels ?? {},
    actionBundle: timer.actionBundle
      ? actionBundleFromProto(timer.actionBundle)
      : undefined,
    agentBinding: timer.agentBinding
      ? agentBindingFromProto(timer.agentBinding)
      : undefined,
    firedAt: fromTimestamp(timer.firedAt) ?? undefined,
    cancelledAt: fromTimestamp(timer.cancelledAt) ?? undefined,
    cancelReason: timer.cancelReason || undefined,
    cancelledBy: timer.cancelledBy || undefined,
  };
};

const toTimestamp = (isoString: string): ProtoTimestamp => {
  const date = new Date(isoString);
  const milliseconds = date.getTime();
  const seconds = Math.floor(milliseconds / 1000);
  const nanos = (milliseconds - seconds * 1000) * 1_000_000;
  return {
    seconds: seconds.toString(),
    nanos,
  };
};

const fromTimestamp = (timestamp?: ProtoTimestamp | null): string | undefined => {
  if (!timestamp) {
    return undefined;
  }
  const seconds = Number(timestamp.seconds ?? 0);
  const millis = seconds * 1000 + Math.floor((timestamp.nanos ?? 0) / 1_000_000);
  const date = new Date(millis);
  return date.toISOString();
};

const actionBundleToProto = (bundle: TimerActionBundle) => ({
  actions: bundle.actions.map(actionToProto),
  concurrency: bundle.concurrency,
  retryPolicy: bundle.retryPolicy
    ? {
        maxAttempts: bundle.retryPolicy.maxAttempts,
        backoffInitialMs:
          bundle.retryPolicy.backoffInitialMs !== undefined
            ? bundle.retryPolicy.backoffInitialMs.toString()
            : undefined,
        backoffMultiplier: bundle.retryPolicy.backoffMultiplier,
      }
    : undefined,
});

const actionToProto = (action: TimerAction): any => ({
  id: action.id,
  kind: action.kind,
  parameters: jsonToProtoStruct(asRecord(action.parameters)),
  escalation: action.escalation
    ? {
        afterAttempts: action.escalation.afterAttempts,
        escalatesTo: action.escalation.escalatesTo
          ? actionToProto(action.escalation.escalatesTo)
          : undefined,
      }
    : undefined,
});

const actionBundleFromProto = (bundle: any): TimerActionBundle => ({
  actions: (bundle.actions ?? []).map(actionFromProto),
  concurrency: Math.max(1, Number(bundle.concurrency ?? 1)),
  retryPolicy: bundle.retryPolicy
    ? {
        maxAttempts: Number(bundle.retryPolicy.maxAttempts ?? 0),
        backoffInitialMs: Number(bundle.retryPolicy.backoffInitialMs ?? 0),
        backoffMultiplier: Number(bundle.retryPolicy.backoffMultiplier ?? 0),
      }
    : undefined,
});

const actionFromProto = (action: any): TimerAction => ({
  id: action.id,
  kind: action.kind,
  parameters: action.parameters
    ? protoStructToJson(action.parameters)
    : {},
  escalation: action.escalation
    ? {
        afterAttempts: Number(action.escalation.afterAttempts ?? 0),
        escalatesTo: action.escalation.escalatesTo
          ? actionFromProto(action.escalation.escalatesTo)
          : undefined,
      }
    : undefined,
});

const agentBindingToProto = (binding: AgentBinding) => ({
  adapter: binding.adapter,
  target: binding.target,
  payloadTemplate: jsonToProtoStruct(asRecord(binding.payloadTemplate ?? {})),
  acknowledgementTimeoutMs: binding.acknowledgementTimeoutMs
    ? binding.acknowledgementTimeoutMs.toString()
    : undefined,
});

const agentBindingFromProto = (binding: any): AgentBinding => ({
  adapter: binding.adapter,
  target: binding.target,
  payloadTemplate: binding.payloadTemplate
    ? protoStructToJson(binding.payloadTemplate)
    : {},
  acknowledgementTimeoutMs: Number(binding.acknowledgementTimeoutMs ?? 0),
});

const jsonToProtoStruct = (value: Record<string, unknown>): ProtoStruct => ({
  fields: Object.fromEntries(
    Object.entries(value).map(([key, val]) => [key, jsonToProtoValue(val)]),
  ),
});

const jsonToProtoValue = (value: unknown): ProtoValue => {
  if (value === null || value === undefined) {
    return { nullValue: 0 };
  }
  if (Array.isArray(value)) {
    return {
      listValue: { values: value.map((item) => jsonToProtoValue(item)) },
    };
  }
  if (typeof value === 'object') {
    return { structValue: jsonToProtoStruct(value as Record<string, unknown>) };
  }
  if (typeof value === 'number') {
    return { numberValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  return { stringValue: String(value) };
};

const protoStructToJson = (struct: ProtoStruct): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(struct.fields ?? {}).map(([key, val]) => [
      key,
      protoValueToJson(val),
    ]),
  );

const protoValueToJson = (value: ProtoValue): unknown => {
  if (value.structValue) {
    return protoStructToJson(value.structValue);
  }
  if (value.listValue) {
    return value.listValue.values.map((item) => protoValueToJson(item));
  }
  if (value.stringValue !== undefined) {
    return value.stringValue;
  }
  if (value.numberValue !== undefined) {
    return Number(value.numberValue);
  }
  if (value.boolValue !== undefined) {
    return Boolean(value.boolValue);
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};
