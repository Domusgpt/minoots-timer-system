import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';

import {
  AgentBinding,
  TimerAction,
  TimerActionBundle,
  TimerRecord,
  TimerStatus,
} from '../types/timer';
import { KernelGateway, KernelScheduleInput } from './kernelGateway';

const DEFAULT_ADDR = process.env.KERNEL_GRPC_ADDR ?? '0.0.0.0:50051';
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

if (!HorologyKernelClientCtor) {
  throw new Error('Failed to load HorologyKernel service definition from proto');
}

type TimestampLike = { seconds: number | string; nanos?: number };

type UnaryMethod = 'scheduleTimer' | 'cancelTimer' | 'getTimer' | 'listTimers';

export class GrpcKernelGateway implements KernelGateway {
  private readonly client: grpc.Client;

  constructor(private readonly address: string = DEFAULT_ADDR) {
    this.client = new HorologyKernelClientCtor(address, grpc.credentials.createInsecure());
  }

  async scheduleTimer(request: KernelScheduleInput): Promise<TimerRecord> {
    const response = await this.unaryCall<{ timer?: unknown }>('scheduleTimer', {
      tenantId: request.tenantId,
      requestedBy: request.requestedBy,
      name: request.name,
      durationMs: request.durationMs,
      fireTime: isoToTimestamp(request.fireAt),
      metadata: request.metadata ?? undefined,
      labels: request.labels ?? {},
      actionBundle: request.actionBundle ? toProtoActionBundle(request.actionBundle) : undefined,
      agentBinding: request.agentBinding ? toProtoAgentBinding(request.agentBinding) : undefined,
    });

    if (!response.timer) {
      throw new Error('Kernel returned an empty timer payload');
    }

    return fromProtoTimer(response.timer);
  }

  async cancelTimer(
    tenantId: string,
    timerId: string,
    reason: string | undefined,
    cancelledBy: string,
  ): Promise<TimerRecord | null> {
    try {
      const timer = await this.unaryCall<unknown>('cancelTimer', {
        tenantId,
        timerId,
        reason: reason ?? '',
        cancelledBy,
      });
      return fromProtoTimer(timer);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async getTimer(tenantId: string, timerId: string): Promise<TimerRecord | null> {
    try {
      const timer = await this.unaryCall<unknown>('getTimer', { tenantId, timerId });
      return fromProtoTimer(timer);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async listTimers(tenantId: string): Promise<TimerRecord[]> {
    const response = await this.unaryCall<{ timers?: unknown[] }>('listTimers', {
      tenantId,
      pageSize: 0,
      statuses: [],
    });

    return (response.timers ?? []).map((timer) => fromProtoTimer(timer));
  }

  private unaryCall<TResponse>(method: UnaryMethod, payload: Record<string, unknown>): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.client as any)[method](payload, (error: grpc.ServiceError | null, response: TResponse) => {
        if (error) {
          reject(normalizeGrpcError(error));
        } else {
          resolve(response);
        }
      });
    });
  }
}

function normalizeGrpcError(error: grpc.ServiceError): Error {
  const normalized = new Error(error.details || error.message);
  (normalized as grpc.ServiceError).code = error.code;
  return normalized;
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as grpc.ServiceError).code === grpc.status.NOT_FOUND,
  );
}

function mapStatus(status: string): TimerStatus {
  switch (status) {
    case 'TIMER_STATUS_SCHEDULED':
      return 'scheduled';
    case 'TIMER_STATUS_ARMED':
      return 'armed';
    case 'TIMER_STATUS_FIRED':
      return 'fired';
    case 'TIMER_STATUS_CANCELLED':
      return 'cancelled';
    case 'TIMER_STATUS_FAILED':
      return 'failed';
    default:
      return 'scheduled';
  }
}

function timestampToIso(timestamp?: TimestampLike | null): string | undefined {
  if (!timestamp) {
    return undefined;
  }
  const seconds = typeof timestamp.seconds === 'string' ? Number(timestamp.seconds) : timestamp.seconds;
  const nanos = timestamp.nanos ?? 0;
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  const millis = seconds * 1000 + Math.floor(nanos / 1_000_000);
  return new Date(millis).toISOString();
}

function isoToTimestamp(iso: string): { seconds: number; nanos: number } {
  const date = new Date(iso);
  const millis = date.getTime();
  if (Number.isNaN(millis)) {
    throw new Error(`Invalid fireAt timestamp: ${iso}`);
  }
  const seconds = Math.floor(millis / 1000);
  const nanos = (millis % 1000) * 1_000_000;
  return { seconds, nanos };
}

function fromProtoTimer(raw: unknown): TimerRecord {
  const timer = raw as Record<string, unknown>;
  const metadata = (timer.metadata as Record<string, unknown> | undefined) ?? undefined;
  const labels = (timer.labels as Record<string, string> | undefined) ?? undefined;
  const actionBundle = timer.actionBundle as Record<string, unknown> | undefined;
  const agentBinding = timer.agentBinding as Record<string, unknown> | undefined;

  const createdAt = timestampToIso(timer.createdAt as TimestampLike | undefined);
  const fireAt = timestampToIso(timer.fireAt as TimestampLike | undefined);

  if (!createdAt || !fireAt) {
    throw new Error('Kernel timer is missing createdAt or fireAt timestamps');
  }

  return {
    id: String(timer.id ?? ''),
    tenantId: String(timer.tenantId ?? ''),
    requestedBy: String(timer.requestedBy ?? ''),
    name: String(timer.name ?? ''),
    status: mapStatus(String(timer.status ?? '')),
    durationMs: Number(timer.durationMs ?? 0),
    createdAt,
    fireAt,
    metadata,
    labels,
    actionBundle: actionBundle ? fromProtoActionBundle(actionBundle) : undefined,
    agentBinding: agentBinding ? fromProtoAgentBinding(agentBinding) : undefined,
    firedAt: timestampToIso(timer.firedAt as TimestampLike | undefined),
    cancelledAt: timestampToIso(timer.cancelledAt as TimestampLike | undefined),
    cancelReason: stringOrUndefined(timer.cancelReason),
    cancelledBy: stringOrUndefined(timer.cancelledBy),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.length > 0 ? value : undefined;
}

function fromProtoActionBundle(bundle: Record<string, unknown>): TimerActionBundle {
  const actions = Array.isArray(bundle.actions)
    ? bundle.actions.map((action) => fromProtoAction(action as Record<string, unknown>))
    : [];
  const retryPolicy = bundle.retryPolicy as Record<string, unknown> | undefined;

  return {
    actions,
    concurrency:
      typeof bundle.concurrency === 'number' && Number.isFinite(bundle.concurrency)
        ? bundle.concurrency
        : 1,
    retryPolicy: retryPolicy ? fromProtoRetryPolicy(retryPolicy) : undefined,
  };
}

function fromProtoRetryPolicy(raw: Record<string, unknown>): TimerActionBundle['retryPolicy'] {
  return {
    maxAttempts: Number(raw.maxAttempts ?? 0),
    backoffInitialMs: Number(raw.backoffInitialMs ?? 0),
    backoffMultiplier: Number(raw.backoffMultiplier ?? 0),
  };
}

function fromProtoAction(raw: Record<string, unknown>): TimerAction {
  const escalation = raw.escalation as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? ''),
    kind: raw.kind as TimerAction['kind'],
    parameters: (raw.parameters as Record<string, unknown> | undefined) ?? {},
    escalation: escalation ? fromProtoEscalation(escalation) : undefined,
  };
}

function fromProtoEscalation(raw: Record<string, unknown>): TimerAction['escalation'] {
  const escalatesTo = raw.escalatesTo as Record<string, unknown> | undefined;
  return {
    afterAttempts: Number(raw.afterAttempts ?? 0),
    escalatesTo: escalatesTo ? fromProtoAction(escalatesTo) : undefined,
  };
}

function fromProtoAgentBinding(raw: Record<string, unknown>): AgentBinding {
  return {
    adapter: normalizeAgentAdapter(raw.adapter),
    target: String(raw.target ?? ''),
    payloadTemplate: (raw.payloadTemplate as Record<string, unknown> | undefined) ?? {},
    acknowledgementTimeoutMs: Number(raw.acknowledgementTimeoutMs ?? 0),
  };
}

function toProtoActionBundle(bundle: TimerActionBundle): Record<string, unknown> {
  return {
    actions: bundle.actions.map((action) => toProtoAction(action)),
    concurrency: bundle.concurrency,
    retryPolicy: bundle.retryPolicy
      ? {
          maxAttempts: bundle.retryPolicy.maxAttempts,
          backoffInitialMs: bundle.retryPolicy.backoffInitialMs,
          backoffMultiplier: bundle.retryPolicy.backoffMultiplier,
        }
      : undefined,
  };
}

function toProtoAction(action: TimerAction): Record<string, unknown> {
  return {
    id: action.id,
    kind: action.kind,
    parameters: action.parameters ?? {},
    escalation: action.escalation
      ? {
          afterAttempts: action.escalation.afterAttempts,
          escalatesTo: action.escalation.escalatesTo
            ? toProtoAction(action.escalation.escalatesTo)
            : undefined,
        }
      : undefined,
  };
}

function toProtoAgentBinding(binding: AgentBinding): Record<string, unknown> {
  return {
    adapter: binding.adapter,
    target: binding.target,
    payloadTemplate: binding.payloadTemplate ?? {},
    acknowledgementTimeoutMs: binding.acknowledgementTimeoutMs,
  };
}

function normalizeAgentAdapter(value: unknown): AgentBinding['adapter'] {
  if (value === 'mcp' || value === 'langchain' || value === 'autogen' || value === 'custom') {
    return value;
  }
  return 'custom';
}

