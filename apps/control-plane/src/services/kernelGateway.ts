import { TimerRecord } from '../types/timer';

export interface KernelGateway {
  schedule(timer: TimerRecord): Promise<void>;
  cancel(timer: TimerRecord, reason?: string): Promise<void>;
}

export class NoopKernelGateway implements KernelGateway {
  async schedule(): Promise<void> {
    // Intentionally empty until gRPC integration is wired up.
  }

  async cancel(): Promise<void> {
    // Intentionally empty until gRPC integration is wired up.
  }
}
