import { buildSignedHeaders } from '../policy/authenticator';
import { QuotaExceededError, QuotaManager } from '../policy/quotaManager';
import { AuthContext } from '../policy/types';
import {
  TimerCancelInput,
  TimerCreateInput,
  TimerGraphDefinition,
  TimerGraphInput,
  TimerGraphNodeInput,
  JitterPolicy,
  JitterPolicyInput,
  TimerRecord,
} from '../types/timer';
import { computeFireTimestamp, parseDurationMs } from '../utils/duration';
import {
  KernelGateway,
  KernelGatewayContext,
  TimerCancelCommand,
  TimerScheduleCommand,
  TimerEventHandlers,
  TimerEventStreamOptions,
  TimerEventSubscription,
} from './kernelGateway';

export class TimerService {
  constructor(
    private readonly kernelGateway: KernelGateway,
    private readonly quotaManager: QuotaManager,
  ) {}

  async createTimer(context: AuthContext, input: TimerCreateInput): Promise<TimerRecord> {
    await this.quotaManager.enforceScheduleQuota(context);

    const now = new Date();
    const durationMs = input.duration
      ? parseDurationMs(input.duration)
      : this.durationFromFireAt(input.fireAt!, now);

    const fireAt = computeFireTimestamp(durationMs, now);
    const temporalGraph = normalizeTemporalGraph(input.temporalGraph, durationMs);
    const jitterPolicy = normalizeJitterPolicy(input.jitterPolicy);

    const scheduleCommand: TimerScheduleCommand = {
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      name: input.name ?? `timer_${now.getTime()}`,
      durationMs,
      fireAt,
      metadata: cloneNullable(input.metadata),
      labels: input.labels ? { ...input.labels } : {},
      actionBundle: cloneNullable(input.actionBundle),
      agentBinding: cloneNullable(input.agentBinding),
      temporalGraph,
      jitterPolicy,
    };

    return this.kernelGateway.schedule(scheduleCommand, this.toGatewayContext(context));
  }

  async listTimers(context: AuthContext): Promise<TimerRecord[]> {
    return this.kernelGateway.list(context.tenantId, this.toGatewayContext(context));
  }

  async getTimer(context: AuthContext, id: string): Promise<TimerRecord | null> {
    return this.kernelGateway.get(context.tenantId, id, this.toGatewayContext(context));
  }

  async cancelTimer(
    context: AuthContext,
    id: string,
    payload: TimerCancelInput,
  ): Promise<TimerRecord | null> {
    const command: TimerCancelCommand = {
      tenantId: context.tenantId,
      timerId: id,
      requestedBy: payload.requestedBy,
      reason: payload.reason,
    };

    return this.kernelGateway.cancel(command, this.toGatewayContext(context));
  }

  translateError(error: unknown): Error {
    if (error instanceof QuotaExceededError) {
      return error;
    }
    return error instanceof Error ? error : new Error('Unknown timer service error');
  }

  subscribeEvents(
    context: AuthContext,
    options: TimerEventStreamOptions,
    handlers: TimerEventHandlers,
  ): TimerEventSubscription {
    return this.kernelGateway.streamEvents(options, this.toGatewayContext(context), handlers);
  }

  private durationFromFireAt(fireAt: string, now = new Date()): number {
    const fireAtDate = new Date(fireAt);
    if (Number.isNaN(fireAtDate.getTime())) {
      throw new Error(`Invalid fireAt timestamp: ${fireAt}`);
    }

    const diff = fireAtDate.getTime() - now.getTime();
    if (diff <= 0) {
      throw new Error('fireAt must be in the future');
    }

    return diff;
  }

  private toGatewayContext(context: AuthContext): KernelGatewayContext {
    return {
      tenantId: context.tenantId,
      principalId: context.principalId,
      traceId: context.traceId,
      headers: buildSignedHeaders(context),
    };
  }
}

const normalizeTemporalGraph = (
  graph: TimerGraphInput,
  baseDurationMs: number,
): TimerGraphDefinition | undefined => {
  if (!graph) {
    return undefined;
  }

  const nodes = graph.nodes.map((node) => normalizeGraphNode(node, baseDurationMs));
  return {
    root: graph.root ?? 'root',
    nodes,
  };
};

const normalizeGraphNode = (
  node: TimerGraphNodeInput,
  baseDurationMs: number,
): TimerGraphDefinition['nodes'][number] => {
  const offsetMs =
    typeof node.offsetMs === 'number'
      ? node.offsetMs
      : resolveDurationValue(node.offset, undefined) ?? baseDurationMs;
  const durationMs =
    typeof node.durationMs === 'number'
      ? node.durationMs
      : resolveDurationValue(node.duration, offsetMs) ?? offsetMs;

  return {
    id: node.id,
    after: [...(node.after ?? [])],
    offsetMs,
    durationMs,
    metadata: cloneNullable(node.metadata),
    labels: node.labels ? { ...node.labels } : undefined,
    actionBundle: cloneNullable(node.actionBundle),
    agentBinding: cloneNullable(node.agentBinding),
  };
};

const normalizeJitterPolicy = (
  policy: JitterPolicyInput,
): JitterPolicy | undefined => {
  if (!policy) {
    return undefined;
  }
  return {
    maxCompensationMs: policy.maxCompensationMs ?? 0,
    smoothingFactor: policy.smoothingFactor ?? 0.2,
  };
};

const resolveDurationValue = (
  value: string | number | undefined,
  fallback?: number,
): number | undefined => {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return parseDurationMs(value);
  }
  return fallback;
};

const cloneNullable = <T>(value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};
