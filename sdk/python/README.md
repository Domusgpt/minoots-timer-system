# MINOOTS Python SDK (Async Preview)

This package provides an async-first Python interface to the MINOOTS Independent Timer System. It mirrors the capabilities of
the Node.js client so agents, backends, and orchestration services can orchestrate timers without managing HTTP plumbing.

## Features

- Async/await friendly API powered by `httpx`
- Built-in helpers for `create_timer`, `quick_wait`, `wait_for`, and `poll_timer`
- Automatic `x-api-key` handling and timeout management
- Duration parsing helpers that match the JavaScript SDK

## Installation (local development)

```bash
pip install -e .
```

## Usage

```python
import asyncio
from minoots import AsyncMinootsClient

async def main():
    async with AsyncMinootsClient(api_key="mnt_test_key") as client:
        health = await client.health()
        print("API status:", health["status"])

        timer_response = await client.create_timer(name="python_task", duration="45s")
        timer_id = timer_response["timer"]["id"]

        final_timer = await client.poll_timer(timer_id, interval_seconds=0.5)
        print("Timer settled:", final_timer["status"])

asyncio.run(main())
```

## Roadmap

- [ ] Add unit tests with mocked responses (pytest + respx)
- [ ] Expose synchronous wrapper for scripts and notebooks
- [ ] Ship LangChain/CrewAI integrations once the async surface stabilizes

Contributions and feedback are welcome as we build out Phase 3 developer tooling.
