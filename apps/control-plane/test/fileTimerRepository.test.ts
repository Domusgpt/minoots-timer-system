import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { FileTimerRepository } from '../src/store/fileTimerRepository';
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
    tempDir = await mkdtemp(join(tmpdir(), 'minoots-test-'));
  });

  it('persists timers to disk and loads them on demand', async () => {
    const path = join(tempDir, 'timers.json');
    const repoA = new FileTimerRepository(path);
    const timer = createTimer();

    await repoA.save(timer);

    const raw = await readFile(path, 'utf-8');
    expect(JSON.parse(raw).tenants.tenant_a).toBeUndefined();
    expect(JSON.parse(raw).tenants['tenant-a']['timer-1'].name).toBe('test-timer');

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
});
