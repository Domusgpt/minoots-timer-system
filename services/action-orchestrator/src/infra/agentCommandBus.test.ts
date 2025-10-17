import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentCommandBus } from './agentCommandBus';
import { TimerInstance } from '../types';

const makeTimer = (): TimerInstance => ({
  id: 'timer-1',
  tenantId: 'tenant-a',
  name: 'root',
  requestedBy: 'tester',
  status: 'scheduled',
  fireAt: new Date(Date.now() + 1_000).toISOString(),
  createdAt: new Date().toISOString(),
  durationMs: 1_000,
});

test('dispatching with unknown adapter fails fast', async () => {
  const bus = createAgentCommandBus();
  await assert.rejects(
    () =>
      bus.dispatch({
        adapter: 'missing',
        target: 'noop',
        payload: {},
        timer: makeTimer(),
      } as any),
    /No agent command connector available/,
  );
});

type Scenario = {
  adapter: 'mcp' | 'langchain' | 'autogen' | 'custom';
  target: string;
};

const scenarios: Scenario[] = [
  { adapter: 'mcp', target: 'session://agent' },
  { adapter: 'langchain', target: 'workflow://demo' },
  { adapter: 'autogen', target: 'swarm://demo' },
  { adapter: 'custom', target: 'https://example.test/hooks' },
];

for (const scenario of scenarios) {
  test(`dispatches through ${scenario.adapter} connector`, async () => {
    const bus = createAgentCommandBus();
    const progressUpdates: string[] = [];
    const response = await bus.dispatch({
      adapter: scenario.adapter,
      target: scenario.target,
      payload: { foo: 'bar' },
      timer: makeTimer(),
      onProgress: (update) => progressUpdates.push(`${update.stage}:${update.message}`),
    });

    assert.equal(response.status, 'accepted');
    assert.ok(response.referenceId);
    const uniqueStages = new Set(progressUpdates);
    assert.ok(progressUpdates.length >= response.progress.length);
    assert.equal(uniqueStages.size, response.progress.length);
    assert.equal(response.connector.length > 0, true);
  });
}
