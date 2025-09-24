import { TimerRepository } from '../store/timerRepository';
import {
  TimerCancelInput,
  TimerCreateInput,
  TimerRecord,
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
    const { durationMs, fireAt } = this.resolveSchedule(input, now);

    const scheduled = await this.kernelGateway.schedule({
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      name: input.name,
      durationMs,
      fireAt,
      metadata: input.metadata,
      labels: input.labels,
      actionBundle: input.actionBundle,
      agentBinding: input.agentBinding,
    });

    await this.repository.save(scheduled);
    return scheduled;
  }

  async listTimers(tenantId: string): Promise<TimerRecord[]> {
    const timers = await this.kernelGateway.list(tenantId);
    await this.repository.replaceAll(tenantId, timers);
    return timers;
  }

  async getTimer(tenantId: string, id: string): Promise<TimerRecord | null> {
    const timer = await this.kernelGateway.get(tenantId, id);
    if (timer) {
      await this.repository.save(timer);
      return timer;
    }
    return this.repository.findById(tenantId, id);
  }

  async cancelTimer(tenantId: string, id: string, payload: TimerCancelInput): Promise<TimerRecord | null> {
    const cancelled = await this.kernelGateway.cancel({
      tenantId,
      timerId: id,
      requestedBy: payload.requestedBy,
      reason: payload.reason,
    });

    if (!cancelled) {
      return null;
    }

    await this.repository.save(cancelled);
    return cancelled;
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

  private resolveSchedule(input: TimerCreateInput, now: Date): { durationMs: number; fireAt: string } {
    if (input.duration) {
      const durationMs = parseDurationMs(input.duration);
      return { durationMs, fireAt: computeFireTimestamp(durationMs, now) };
    }

    if (input.fireAt) {
      const durationMs = this.durationFromFireAt(input.fireAt, now);
      const fireAtIso = new Date(input.fireAt).toISOString();
      return { durationMs, fireAt: fireAtIso };
    }

    throw new Error('Either duration or fireAt must be provided');
  }
}
