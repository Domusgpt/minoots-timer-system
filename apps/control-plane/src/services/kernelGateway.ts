import { AgentBinding, TimerActionBundle, TimerRecord } from '../types/timer';

export interface KernelScheduleInput {
  tenantId: string;
  requestedBy: string;
  name: string;
  durationMs: number;
  fireAt: string;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: TimerActionBundle;
  agentBinding?: AgentBinding;
}

export interface KernelGateway {
  scheduleTimer(request: KernelScheduleInput): Promise<TimerRecord>;
  cancelTimer(
    tenantId: string,
    timerId: string,
    reason: string | undefined,
    cancelledBy: string,
  ): Promise<TimerRecord | null>;
  getTimer(tenantId: string, timerId: string): Promise<TimerRecord | null>;
  listTimers(tenantId: string): Promise<TimerRecord[]>;
}

export class NoopKernelGateway implements KernelGateway {
  async scheduleTimer(): Promise<TimerRecord> {
    throw new Error('Kernel gateway not configured');
  }

  async cancelTimer(): Promise<TimerRecord | null> {
    throw new Error('Kernel gateway not configured');
  }

  async getTimer(): Promise<TimerRecord | null> {
    throw new Error('Kernel gateway not configured');
  }

  async listTimers(): Promise<TimerRecord[]> {
    throw new Error('Kernel gateway not configured');
  }
}
