import { TimerRecord } from '../types/timer';
import { TimerRepository } from './timerRepository';

const clone = (timer: TimerRecord): TimerRecord => JSON.parse(JSON.stringify(timer));

export class InMemoryTimerRepository implements TimerRepository {
  private readonly store = new Map<string, Map<string, TimerRecord>>();

  async save(timer: TimerRecord): Promise<TimerRecord> {
    const tenantStore = this.ensureTenant(timer.tenantId);
    tenantStore.set(timer.id, clone(timer));
    return clone(timer);
  }

  async update(timer: TimerRecord): Promise<TimerRecord> {
    const tenantStore = this.ensureTenant(timer.tenantId);
    if (!tenantStore.has(timer.id)) {
      throw new Error(`Timer ${timer.id} does not exist for tenant ${timer.tenantId}`);
    }
    tenantStore.set(timer.id, clone(timer));
    return clone(timer);
  }

  async findById(tenantId: string, id: string): Promise<TimerRecord | null> {
    const tenantStore = this.store.get(tenantId);
    if (!tenantStore) {
      return null;
    }
    const result = tenantStore.get(id);
    return result ? clone(result) : null;
  }

  async list(tenantId: string): Promise<TimerRecord[]> {
    const tenantStore = this.store.get(tenantId);
    if (!tenantStore) {
      return [];
    }
    return Array.from(tenantStore.values())
      .map((timer) => clone(timer))
      .sort((a, b) => a.fireAt.localeCompare(b.fireAt));
  }

  private ensureTenant(tenantId: string): Map<string, TimerRecord> {
    if (!this.store.has(tenantId)) {
      this.store.set(tenantId, new Map());
    }
    return this.store.get(tenantId)!;
  }
}
