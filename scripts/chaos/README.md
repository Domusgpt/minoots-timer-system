# Chaos Harness

Utilities for exercising the horology kernel under failure modes introduced in Phase 1.

## kernel_faults.sh

```bash
scripts/chaos/kernel_faults.sh [command]
```

Commands:
- `restart` – restarts the kernel container via `docker compose`.
- `latency` – injects latency+jitter using `tc netem` inside the container.
- `clear` – removes injected latency rules.
- `loop` – alternates restart/latency actions until interrupted.

Environment variables allow customising compose file, service name, and chaos parameters. See the script header for details.

> Requires Docker with Compose v2 and `tc` installed inside the target container.
