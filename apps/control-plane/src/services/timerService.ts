import { TimerCancelInput, TimerCreateInput, TimerRecord } from '../types/timer';
import { computeFireTimestamp, parseDurationMs } from '../utils/duration';
import { KernelGateway, TimerCancelCommand, TimerScheduleCommand } from './kernelGateway';

export class TimerService {
  constructor(private readonly kernelGateway: KernelGateway) {}

  async createTimer(input: TimerCreateInput): Promise<TimerRecord> {
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

    return this.kernelGateway.schedule(scheduleCommand);
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
