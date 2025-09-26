import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileTimerRepository, FileSystem } from '../src/store/fileTimerRepository';
import { TimerRecord } from '../src/types/timer';

const createTimer = (overrides: Partial<TimerRecord> = {}): TimerRecord => ({
  id: 'timer-1',
  tenantId: 'tenant-a',
  requestedBy: 'agent-a',
  name: 'test-timer',
  durationMs: 1000,
  createdAt: '2024-01-01T00:00:00.000Z',
  fireAt: '2024-01-01T00:00:01.000Z',
  status: 'scheduled',
  metadata: { example: true },
  labels: { env: 'test' },
  ...overrides,
});

describe('FileTimerRepository', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(join(tmpdir(), 'minoots-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists timers to disk and loads them on demand', async () => {
    const path = join(tempDir, 'timers.json');
    const repoA = new FileTimerRepository(path);
    const timer = createTimer();

    await repoA.save(timer);

    const raw = await fsPromises.readFile(path, 'utf-8');
    const persisted = JSON.parse(raw) as PersistedSnapshot;

    expect(persisted.tenants.tenant_a).toBeUndefined();
    expect(persisted.tenants['tenant-a']['timer-1'].name).toBe('test-timer');

    const repoB = new FileTimerRepository(path);
    const loaded = await repoB.findById('tenant-a', 'timer-1');

    expect(loaded).toMatchObject({
      id: 'timer-1',
      tenantId: 'tenant-a',
      metadata: { example: true },
    });
  });

  it('maintains timer ordering when listing', async () => {
    const path = join(tempDir, 'ordered.json');
    const repo = new FileTimerRepository(path);

    await repo.save(createTimer({ id: 'timer-2', fireAt: '2024-01-01T00:05:00.000Z' }));
    await repo.save(createTimer({ id: 'timer-3', fireAt: '2024-01-01T00:02:00.000Z' }));

    const timers = await repo.list('tenant-a');
    expect(timers.map((t) => t.id)).toEqual(['timer-3', 'timer-2']);
  });

  it('serializes overlapping writes without dropping timers', async () => {
    const path = join(tempDir, 'concurrent.json');
    const repo = new FileTimerRepository(path);

    await Promise.all([
      repo.save(createTimer({ id: 'timer-a', fireAt: '2024-01-01T00:01:00.000Z' })),
      repo.save(createTimer({ id: 'timer-b', fireAt: '2024-01-01T00:02:00.000Z' })),
      repo.save(createTimer({ id: 'timer-c', fireAt: '2024-01-01T00:03:00.000Z' })),
    ]);

    const raw = await fsPromises.readFile(path, 'utf-8');
    const persisted = JSON.parse(raw) as PersistedSnapshot;

    const keys = Object.keys(persisted.tenants['tenant-a'] ?? {}).sort();
    expect(keys).toEqual(['timer-a', 'timer-b', 'timer-c']);
  });

  it('recovers from write failures so subsequent saves succeed', async () => {
    const path = join(tempDir, 'recovery.json');

    const writeMock = vi
      .fn<FileSystem['writeFile']>()
      .mockRejectedValueOnce(new Error('disk-full'))
      .mockResolvedValue(undefined);

    const fakeFs: FileSystem = {
      ...fsPromises,
      writeFile: writeMock,
    };

    const repo = new FileTimerRepository(path, fakeFs);

    await expect(repo.save(createTimer({ id: 'timer-fail' }))).rejects.toThrow('disk-full');

    await expect(
      repo.save(createTimer({ id: 'timer-success', fireAt: '2024-01-01T00:10:00.000Z' })),
    ).resolves.toMatchObject({ id: 'timer-success' });

    expect(writeMock).toHaveBeenCalledTimes(2);
  });
});

interface PersistedSnapshot {
  tenants: Record<string, Record<string, TimerRecord>>;
}
