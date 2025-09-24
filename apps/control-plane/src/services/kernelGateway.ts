import { TimerRecord } from '../types/timer';

export interface KernelGateway {
  schedule(timer: TimerRecord): Promise<TimerRecord | null>;
  cancel(tenantId: string, timerId: string, reason?: string, cancelledBy?: string): Promise<TimerRecord | null>;
  get(tenantId: string, timerId: string): Promise<TimerRecord | null>;
  list(tenantId: string): Promise<TimerRecord[]>;
}

export class NoopKernelGateway implements KernelGateway {
  async schedule(timer: TimerRecord): Promise<TimerRecord | null> {
    return timer;
  }

  async cancel(): Promise<TimerRecord | null> {
    return null;
  }

  async get(): Promise<TimerRecord | null> {
    return null;
  }

  async list(): Promise<TimerRecord[]> {
    return [];
  }
}
