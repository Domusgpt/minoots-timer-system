import { AgentBinding, TimerActionBundle, TimerRecord } from '../types/timer';

export interface KernelScheduleRequest {
  tenantId: string;
  requestedBy: string;
  name?: string;
  durationMs?: number;
  fireAt?: string;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: TimerActionBundle;
  agentBinding?: AgentBinding;
}

export interface KernelCancelRequest {
  tenantId: string;
  timerId: string;
  requestedBy: string;
  reason?: string;
}

export interface KernelGateway {
  schedule(request: KernelScheduleRequest): Promise<TimerRecord>;
  cancel(request: KernelCancelRequest): Promise<TimerRecord | null>;
  get(tenantId: string, timerId: string): Promise<TimerRecord | null>;
  list(tenantId: string): Promise<TimerRecord[]>;
}

export class NoopKernelGateway implements KernelGateway {
  async schedule(): Promise<TimerRecord> {
    throw new Error('Kernel gateway not configured');
  }

  async cancel(): Promise<TimerRecord | null> {
    throw new Error('Kernel gateway not configured');
  }

  async get(): Promise<TimerRecord | null> {
    throw new Error('Kernel gateway not configured');
  }

  async list(): Promise<TimerRecord[]> {
    throw new Error('Kernel gateway not configured');
  }
}
