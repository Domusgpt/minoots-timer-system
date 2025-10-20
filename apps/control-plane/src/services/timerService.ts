import { buildSignedHeaders } from '../policy/authenticator';
import { QuotaExceededError, QuotaManager } from '../policy/quotaManager';
import { AuthContext } from '../policy/types';
import { TimerCancelInput, TimerCreateInput, TimerRecord } from '../types/timer';
import {
  applyEcosystemLabels,
  embedEcosystemIntoMetadata,
  mergeEcosystem,
  readEcosystemFromMetadata,
} from '../types/ecosystem';
import { computeFireTimestamp, parseDurationMs } from '../utils/duration';
import {
  KernelEventStream,
  KernelGateway,
  KernelGatewayContext,
  TimerCancelCommand,
  TimerScheduleCommand,
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

    const baseMetadata = cloneNullable(input.metadata);
    const existingEcosystem = readEcosystemFromMetadata(baseMetadata);
    const ecosystem = mergeEcosystem(existingEcosystem, input.ecosystem);
    const metadata = embedEcosystemIntoMetadata(baseMetadata, ecosystem);

    const labels = input.labels ? { ...input.labels } : {};
    applyEcosystemLabels(labels, ecosystem);
    const labelPayload = Object.keys(labels).length > 0 ? labels : undefined;

    const fireAt = computeFireTimestamp(durationMs, now);
    const scheduleCommand: TimerScheduleCommand = {
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      name: input.name ?? `timer_${now.getTime()}`,
      durationMs,
      fireAt,
      metadata,
      labels: labelPayload,
      actionBundle: cloneNullable(input.actionBundle),
      agentBinding: cloneNullable(input.agentBinding),
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

  streamEvents(context: AuthContext, tenantId: string): KernelEventStream {
    if (tenantId !== context.tenantId) {
      throw new Error('Authenticated principal cannot subscribe to another tenant');
    }
    return this.kernelGateway.streamEvents(tenantId, this.toGatewayContext(context));
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
    const headers = buildSignedHeaders(context);
    if (context.preferredRegion) {
      headers['x-minoots-region'] = context.preferredRegion;
    }
    return {
      tenantId: context.tenantId,
      principalId: context.principalId,
      traceId: context.traceId,
      headers,
    };
  }
}

const cloneNullable = <T>(value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};
