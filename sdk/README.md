# MINOOTS Node.js & Python SDKs

Developer tooling for the MINOOTS Independent Timer System. Phase 3 kicks off with a modernized Node.js SDK (typed, testable,
stream-friendly) and a brand-new Python async client skeleton.

## Node.js SDK

### Installation

```bash
npm install minoots-sdk
```

or use it directly from the repository for local development:

```javascript
const MinootsSDK = require('./minoots-sdk.js');
```

### Quick Start (JavaScript)

```javascript
const MinootsSDK = require('minoots-sdk');

const minoots = new MinootsSDK({
  apiKey: process.env.MINOOTS_API_KEY,
  agentId: 'my_agent',
  team: 'my_team'
});

async function main() {
  await minoots.health();

  const { timer } = await minoots.createTimer({
    name: 'data_processing',
    duration: '5m',
    metadata: { correlationId: 'abc123' }
  });

  const finalTimer = await minoots.pollTimer(timer.id, 1000);
  console.log(`Timer ${finalTimer.id} finished with status ${finalTimer.status}`);
}

main().catch(console.error);
```

### TypeScript Support

`minoots-sdk` now ships first-class type definitions with helpful builders:

```typescript
import MinootsSDK, { Timer, DurationInput } from 'minoots-sdk';

const client = new MinootsSDK({
  apiKey: process.env.MINOOTS_API_KEY,
  agentId: 'ts_agent',
});

async function schedule(duration: DurationInput): Promise<Timer> {
  const response = await client.createTimer({
    name: 'ts_task',
    duration,
    metadata: { type: 'typescript' },
  });

  return client.waitFor(duration, { pollIntervalMs: 500 });
}
```

### Core Methods

- `health()` – Verify API status.
- `createTimer()` / `createTimerWithWebhook()` – Create timers with optional webhook payloads.
- `quickWait()` – Fire-and-forget timers with sensible defaults.
- `waitFor()` – Convenience helper that schedules and blocks until the timer settles.
- `pollTimer()` – Poll an existing timer until it completes.
- `listTimers()` / `getTimer()` / `deleteTimer()` – CRUD helpers (deletions now return cascade counts for logs, metrics, and queue entries).
- `replayTimer()` – Rehydrate failed or historical timers with optional overrides for metadata, duration, or routing.
- `streamTimerEvents()` – Subscribe to Server-Sent Events for tenant-level activity.
- `parseDuration()` / `formatTimeRemaining()` – Utility helpers for duration math.

### Advanced Usage

```javascript
// Clone with overrides without mutating the original client
const proClient = minoots.withDefaults({ team: 'pro_team', apiKey: 'mnt_live_key' });

// Stream timer events (SSE)
const stop = proClient.streamTimerEvents('tenant-123', {
  topics: ['timer.expired'],
  onEvent(event) {
    console.log('Timer event:', event);
  },
  onError(err) {
    console.error('Stream error', err);
  }
});

// Later, close the stream
stop();
```

### Replay & Recovery

Replay helpers make it easy to re-run failed automations or restart long-lived schedules without rebuilding payloads:

```javascript
const { replay } = await minoots.replayTimer(timer.id, {
  reason: 'manual-restart',
  metadata: { requestedBy: 'ops@example.com' },
});

console.log('Replayed timer', replay.id);

const deletion = await minoots.deleteTimer(timer.id);
console.log('Cascade stats', deletion.cascade);
```

### Retry & Observability Hooks

Every client now supports exponential backoff with jitter and lifecycle hooks. Use `withRetry` to opt into automatic retries for transient errors and attach hooks for instrumentation:

```javascript
const resilient = minoots.withRetry({ attempts: 3, minTimeout: 250, maxTimeout: 2_000 });

resilient.hooks.beforeRequest.push(({ url, attempt }) => {
  console.log(`[attempt ${attempt}] -> ${url}`);
});

resilient.hooks.onRetry.push(({ error, attempt }) => {
  console.warn(`Retrying after ${error.message} (attempt ${attempt})`);
});

const { timer } = await resilient.createTimer({ name: 'resilient', duration: '10s' });
```

### React Hook (`useMinootsTimer`)

A first-party React hook lives in `sdk/react/useMinootsTimer.ts` for agentic UIs:

```tsx
import { useMinootsTimer } from '../react/useMinootsTimer';

export function AgentTimer() {
  const { timer, status, start, cancel } = useMinootsTimer('30s', {
    autoStart: false,
    onSettled(finalTimer) {
      console.log('Timer settled', finalTimer);
    },
  });

  return (
    <div>
      <p>Status: {status}</p>
      <button onClick={() => start()}>Start</button>
      <button onClick={cancel}>Cancel</button>
      {timer ? <pre>{JSON.stringify(timer, null, 2)}</pre> : null}
    </div>
  );
}
```

### Vue Composable (`useMinootsTimer`)

Vue 3 developers can drop in `sdk/vue/useMinootsTimer.ts`:

```ts
import { ref } from 'vue';
import { useMinootsTimer } from '../vue/useMinootsTimer';

const duration = ref('45s');
const { timer, status, start } = useMinootsTimer(duration, {
  autoStart: false,
});

await start();
```

### Testing

The repository ships a mocked test harness. Run it with:

```bash
cd sdk
npm test
```

The tests no longer rely on the live API; they stub fetch calls and validate request construction, error handling, and polling.

### Replay Queue & Firestore Indexes

The parserator replay queue uses composite queries on `(status, enqueuedAt)` for the scheduler sweep and `(status, processedAt)` during cleanup. Import the definitions in `firestore.indexes.json` (or create equivalent indexes in the Firebase console) before deploying to production.

## Python Async SDK (Preview)

Phase 3 also introduces the first cut of an async Python client powered by `httpx`. It lives in `sdk/python/`.

### Install (local development)

```bash
cd sdk/python
pip install -e .
```

Optional integrations:

```bash
pip install langchain-core llama-index-core
```

### Usage

```python
import asyncio
from minoots import AsyncMinootsClient

async def main():
    async with AsyncMinootsClient(api_key="mnt_test_key") as client:
        health = await client.health()
        print("API status:", health["status"])

        timer = await client.create_timer(name="python_task", duration="30s")
        final_timer = await client.wait_for("30s")
        print("Timer complete:", final_timer["status"])

asyncio.run(main())
```

The Python module currently focuses on async workflows (matching modern agent stacks) and now ships helper modules for LangChain and
LlamaIndex integrations while sync wrappers land in a future cut.

### Agent Framework Integrations

- `minoots.integrations.langchain.AtoTimerTool` — LangChain tool exposing `create_timer`/`wait_for` with friendly prompts.
- `minoots.integrations.llamaindex.create_minoots_tool` — utility that returns a `FunctionTool` for LlamaIndex agent nodes.

## Contributing

1. Run `npm test` inside `sdk/` after making changes.
2. Keep the TypeScript definitions (`minoots-sdk.d.ts`) in sync with `minoots-sdk.js`.
3. Document significant changes in the implementation log and roadmap to keep Phase 3 aligned.
4. When changing the React/Vue hooks or Python integrations, refresh the examples above to avoid drift.

Happy timing! ⏱️
