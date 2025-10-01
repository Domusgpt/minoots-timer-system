import { TimerCancelInput, TimerCreateInput, TimerRecord } from '../types/timer';
import { computeFireTimestamp, parseDurationMs } from '../utils/duration';
import { UsageTracker } from './usageTracker';
import { KernelGateway, TimerCancelCommand, TimerScheduleCommand } from './kernelGateway';

export interface TimerRequestContext {
  userId: string;
  tier: string;
}

export class TimerService {
  constructor(
    private readonly kernelGateway: KernelGateway,
    private readonly usageTracker: UsageTracker,
  ) {}

  async createTimer(input: TimerCreateInput, context: TimerRequestContext): Promise<TimerRecord> {
    const usage = await this.usageTracker.checkDailyLimit(context.userId, context.tier);
    if (!usage.allowed) {
      throw new Error(usage.message ?? 'Daily usage limit reached');
    }

    const now = new Date();
    const durationMs = input.duration
      ? parseDurationMs(input.duration)
      : this.durationFromFireAt(input.fireAt!, now);

    const fireAt = computeFireTimestamp(durationMs, now);
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
    };

    const timer = await this.kernelGateway.schedule(scheduleCommand);
    await this.usageTracker.trackTimerCreation(context.userId, timer);
    return timer;
  }

  async listTimers(tenantId: string): Promise<TimerRecord[]> {
    return this.kernelGateway.list(tenantId);
  }

  async getTimer(tenantId: string, id: string): Promise<TimerRecord | null> {
    return this.kernelGateway.get(tenantId, id);
  }

  async cancelTimer(tenantId: string, id: string, payload: TimerCancelInput): Promise<TimerRecord | null> {
    const command: TimerCancelCommand = {
      tenantId,
      timerId: id,
      requestedBy: payload.requestedBy,
      reason: payload.reason,
    };

    return this.kernelGateway.cancel(command);
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
}

const cloneNullable = <T>(value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};
