import { AuthContext } from '../types/auth';
import { TimerCancelInput, TimerCreateInput, TimerRecord } from '../types/timer';
import { computeFireTimestamp, parseDurationMs } from '../utils/duration';
import { KernelGateway, TimerCancelCommand, TimerScheduleCommand } from './kernelGateway';
import { TimerRepository } from '../store/timerRepository';
import { PolicyEngine } from '../policy/policyEngine';
import { QuotaExceededError } from '../policy/quotaMonitor';

export class TimerService {
  constructor(
    private readonly kernelGateway: KernelGateway,
    private readonly repository: TimerRepository,
    private readonly policyEngine: PolicyEngine,
  ) {}

  async createTimer(context: AuthContext, input: TimerCreateInput): Promise<TimerRecord> {
    this.policyEngine.ensurePermission(context, 'timers:create');
    await this.ensureActiveQuota(context);

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

    return this.kernelGateway.schedule(scheduleCommand, context);
  }

  async listTimers(context: AuthContext, tenantId: string): Promise<TimerRecord[]> {
    this.policyEngine.ensurePermission(context, 'timers:read');
    return this.kernelGateway.list(tenantId, context);
  }

  async getTimer(context: AuthContext, tenantId: string, id: string): Promise<TimerRecord | null> {
    this.policyEngine.ensurePermission(context, 'timers:read');
    return this.kernelGateway.get(tenantId, id, context);
  }

  async cancelTimer(
    context: AuthContext,
    tenantId: string,
    id: string,
    payload: TimerCancelInput,
  ): Promise<TimerRecord | null> {
    this.policyEngine.ensurePermission(context, 'timers:cancel');

    const command: TimerCancelCommand = {
      tenantId,
      timerId: id,
      requestedBy: payload.requestedBy,
      reason: payload.reason,
    };

    return this.kernelGateway.cancel(command, context);
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

  private async ensureActiveQuota(context: AuthContext) {
    const active = await this.repository.countActive(context.tenantId);
    if (active >= context.quotas.maxActiveTimers) {
      throw new QuotaExceededError('Active timer quota exceeded');
    }
  }
}

const cloneNullable = <T>(value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};
