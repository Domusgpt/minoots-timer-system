import {
  TimerCancelInput,
  TimerCreateInput,
  TimerRecord,
  TimerStatus,
} from '../types/timer';
import { computeFireTimestamp, parseDurationMs } from '../utils/duration';
import { KernelGateway, KernelScheduleInput, NoopKernelGateway } from './kernelGateway';

export class TimerService {
  constructor(private readonly kernelGateway: KernelGateway = new NoopKernelGateway()) {}

  async createTimer(input: TimerCreateInput): Promise<TimerRecord> {
    const now = new Date();
    const durationMs = input.duration
      ? parseDurationMs(input.duration)
      : this.durationFromFireAt(input.fireAt!, now);

    const fireAt = computeFireTimestamp(durationMs, now);
    const scheduleRequest: KernelScheduleInput = {
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      name: input.name ?? `timer_${now.getTime()}`,
      durationMs,
      fireAt,
      metadata: input.metadata,
      labels: input.labels,
      actionBundle: input.actionBundle,
      agentBinding: input.agentBinding,
    };

    return this.kernelGateway.scheduleTimer(scheduleRequest);
  }

  async listTimers(tenantId: string): Promise<TimerRecord[]> {
    return this.kernelGateway.listTimers(tenantId);
  }

  async getTimer(tenantId: string, id: string): Promise<TimerRecord | null> {
    return this.kernelGateway.getTimer(tenantId, id);
  }

  async cancelTimer(tenantId: string, id: string, payload: TimerCancelInput): Promise<TimerRecord | null> {
    const existing = await this.kernelGateway.getTimer(tenantId, id);
    if (!existing) {
      return null;
    }

    if (this.isTerminal(existing.status)) {
      return existing;
    }

    return this.kernelGateway.cancelTimer(tenantId, id, payload.reason, payload.requestedBy);
  }

  private isTerminal(status: TimerStatus): boolean {
    return status === 'cancelled' || status === 'fired' || status === 'failed';
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
