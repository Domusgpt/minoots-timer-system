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
- `listTimers()` / `getTimer()` / `deleteTimer()` – CRUD helpers.
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

### Testing

The repository ships a mocked test harness. Run it with:

```bash
cd sdk
npm test
```

The tests no longer rely on the live API; they stub fetch calls and validate request construction, error handling, and polling.

## Python Async SDK (Preview)

Phase 3 also introduces the first cut of an async Python client powered by `httpx`. It lives in `sdk/python/`.

### Install (local development)

```bash
cd sdk/python
pip install -e .
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

The Python module currently focuses on async workflows (matching modern agent stacks) and will expand with sync wrappers and
toolkit integrations as Phase 3 progresses.

## Contributing

1. Run `npm test` inside `sdk/` after making changes.
2. Keep the TypeScript definitions (`minoots-sdk.d.ts`) in sync with `minoots-sdk.js`.
3. Document significant changes in the implementation log and roadmap to keep Phase 3 aligned.

Happy timing! ⏱️
