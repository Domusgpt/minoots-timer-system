import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import { logger } from '../telemetry/logger';
import { TimerRecord } from '../types/timer';
import { TimerRepository } from './timerRepository';

interface PersistedStore {
  tenants: Record<string, Record<string, TimerRecord>>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class FileTimerRepository implements TimerRepository {
  private readonly filePath: string;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private readonly store = new Map<string, Map<string, TimerRecord>>();
  private writeLock: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(timer: TimerRecord): Promise<TimerRecord> {
    await this.ensureLoaded();
    const tenantStore = this.ensureTenant(timer.tenantId);
    tenantStore.set(timer.id, clone(timer));
    await this.persist();
    return clone(timer);
  }

  async update(timer: TimerRecord): Promise<TimerRecord> {
    await this.ensureLoaded();
    const tenantStore = this.ensureTenant(timer.tenantId);
    if (!tenantStore.has(timer.id)) {
      throw new Error(`Timer ${timer.id} does not exist for tenant ${timer.tenantId}`);
    }
    tenantStore.set(timer.id, clone(timer));
    await this.persist();
    return clone(timer);
  }

  async findById(tenantId: string, id: string): Promise<TimerRecord | null> {
    await this.ensureLoaded();
    const tenantStore = this.store.get(tenantId);
    if (!tenantStore) {
      return null;
    }
    const record = tenantStore.get(id);
    return record ? clone(record) : null;
  }

  async list(tenantId: string): Promise<TimerRecord[]> {
    await this.ensureLoaded();
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

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }
    this.loadPromise = this.loadFromDisk();
    await this.loadPromise;
    this.loaded = true;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as PersistedStore;
      Object.entries(parsed.tenants ?? {}).forEach(([tenantId, timers]) => {
        const tenantStore = this.ensureTenant(tenantId);
        Object.values(timers ?? {}).forEach((timer) => {
          tenantStore.set(timer.id, timer);
        });
      });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn({ file: this.filePath }, 'No existing timer store found, starting fresh');
        return;
      }
      logger.error({ error }, 'Failed to load timer store from disk');
      throw error;
    }
  }

  private async persist(): Promise<void> {
    const snapshot = Object.fromEntries(
      Array.from(this.store.entries()).map(([tenantId, timers]) => [
        tenantId,
        Object.fromEntries(Array.from(timers.entries()).map(([timerId, timer]) => [timerId, timer])),
      ]),
    );

    const payload: PersistedStore = { tenants: snapshot };
    const json = JSON.stringify(payload, null, 2);

    this.writeLock = this.writeLock.then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, json, 'utf-8');
    });

    try {
      await this.writeLock;
    } catch (error) {
      logger.error({ error }, 'Failed to persist timer store to disk');
      throw error;
    }
  }
}
