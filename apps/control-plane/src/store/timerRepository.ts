import { TimerRecord } from '../types/timer';

export interface TimerRepository {
  save(timer: TimerRecord): Promise<TimerRecord>;
  update(timer: TimerRecord): Promise<TimerRecord>;
  findById(tenantId: string, id: string): Promise<TimerRecord | null>;
  list(tenantId: string): Promise<TimerRecord[]>;
}
