import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimerService } from '../src/services/timerService';
import { InMemoryTimerRepository } from '../src/store/inMemoryTimerRepository';
import { NoopKernelGateway } from '../src/services/kernelGateway';
import { TimerCreateInput } from '../src/types/timer';

const createService = () =>
  new TimerService(new InMemoryTimerRepository(), new NoopKernelGateway());

describe('TimerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseCreateInput = (): TimerCreateInput => ({
    tenantId: 'tenant-1',
    requestedBy: 'agent-1',
    name: 'demo-timer',
    duration: '30s',
    metadata: { foo: 'bar' },
    labels: { env: 'test' },
  });

  it('creates timers with computed fireAt timestamp', async () => {
    const service = createService();
    const timer = await service.createTimer(baseCreateInput());

    expect(timer.id).toMatch(/^[-0-9a-f]+$/);
    expect(timer.status).toBe('scheduled');
    expect(timer.fireAt).toBe('2024-01-01T00:00:30.000Z');
    expect(timer.durationMs).toBe(30_000);
    expect(timer.labels).toEqual({ env: 'test' });
  });

  it('derives duration from fireAt when provided', async () => {
    const service = createService();
    const timer = await service.createTimer({
      ...baseCreateInput(),
      duration: undefined,
      fireAt: '2024-01-01T00:05:00.000Z',
    });

    expect(timer.durationMs).toBe(5 * 60 * 1000);
    expect(timer.fireAt).toBe('2024-01-01T00:05:00.000Z');
  });

  it('cancels timers and records cancellation metadata when kernel has no response', async () => {
    const service = createService();
    const created = await service.createTimer(baseCreateInput());

    const cancelled = await service.cancelTimer('tenant-1', created.id, {
      tenantId: 'tenant-1',
      requestedBy: 'agent-1',
      reason: 'no longer needed',
    });

    expect(cancelled).not.toBeNull();
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelReason).toBe('no longer needed');
    expect(cancelled?.cancelledBy).toBe('agent-1');
    expect(cancelled?.cancelledAt).toBeTruthy();
  });

  it('returns null when cancelling a non-existent timer', async () => {
    const service = createService();
    const result = await service.cancelTimer('tenant-1', 'missing', {
      tenantId: 'tenant-1',
      requestedBy: 'agent-1',
    });

    expect(result).toBeNull();
  });

  it('lists timers from the repository when kernel has no data', async () => {
    const service = createService();
    await service.createTimer(baseCreateInput());

    const timers = await service.listTimers('tenant-1');
    expect(timers).toHaveLength(1);
    expect(timers[0].tenantId).toBe('tenant-1');
  });
});
