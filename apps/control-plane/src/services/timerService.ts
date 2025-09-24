import { v4 as uuid } from 'uuid';
import { TimerRepository } from '../store/timerRepository';
import {
  TimerCancelInput,
  TimerCreateInput,
  TimerRecord,
  TimerStatus,
} from '../types/timer';
import { computeFireTimestamp, parseDurationMs } from '../utils/duration';
import { KernelGateway, NoopKernelGateway } from './kernelGateway';

export class TimerService {
  constructor(
    private readonly repository: TimerRepository,
    private readonly kernelGateway: KernelGateway = new NoopKernelGateway(),
  ) {}

  async createTimer(input: TimerCreateInput): Promise<TimerRecord> {
    const now = new Date();
    const durationMs = input.duration
      ? parseDurationMs(input.duration)
      : this.durationFromFireAt(input.fireAt!, now);

    const fireAt = computeFireTimestamp(durationMs, now);
    const timer: TimerRecord = {
      id: uuid(),
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      name: input.name ?? `timer_${now.getTime()}`,
      durationMs,
      createdAt: now.toISOString(),
      fireAt,
      status: 'scheduled',
      metadata: input.metadata,
      labels: input.labels ?? {},
      actionBundle: input.actionBundle,
      agentBinding: input.agentBinding,
    };

    const scheduled = await this.kernelGateway.schedule(timer);
    const record = await this.repository.save(scheduled ?? timer);
    return record;
  }

  async listTimers(tenantId: string): Promise<TimerRecord[]> {
    const kernelTimers = await this.kernelGateway.list(tenantId);
    if (kernelTimers.length > 0) {
      await Promise.all(kernelTimers.map((timer) => this.repository.save(timer)));
      return kernelTimers;
    }
    return this.repository.list(tenantId);
  }

  async getTimer(tenantId: string, id: string): Promise<TimerRecord | null> {
    const kernelTimer = await this.kernelGateway.get(tenantId, id);
    if (kernelTimer) {
      await this.repository.save(kernelTimer);
      return kernelTimer;
    }
    return this.repository.findById(tenantId, id);
  }

  async cancelTimer(tenantId: string, id: string, payload: TimerCancelInput): Promise<TimerRecord | null> {
    const cancelled = await this.kernelGateway.cancel(
      tenantId,
      id,
      payload.reason,
      payload.requestedBy,
    );

    if (cancelled) {
      return this.repository.save(cancelled);
    }

    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      return null;
    }

    if (this.isTerminal(existing.status)) {
      return existing;
    }

    const fallback: TimerRecord = {
      ...existing,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelReason: payload.reason,
      cancelledBy: payload.requestedBy,
    };

    return this.repository.save(fallback);
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
