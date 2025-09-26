# Horology Kernel

The horology kernel is the durable scheduling core for MINOOTS. It is implemented in Rust to provide deterministic timers,
low jitter, and resilient eventing for agent workloads.

## Capabilities in this foundation
- Asynchronously schedules timers with millisecond precision using Tokio.
- Emits lifecycle events (scheduled, fired, cancelled) via a broadcast channel and optionally publishes to NATS (`NATS_URL`).
- Supports cancellation semantics with tenant scoping and persists state to disk when `KERNEL_PERSIST_PATH` is provided.
- Exposes gRPC endpoints defined in `proto/timer.proto` and includes unit tests for schedule/cancel and proto conversions.

## Running locally
```bash
cd services/horology-kernel
KERNEL_PERSIST_PATH=/tmp/minoots-kernel.json \
NATS_URL=nats://localhost:4222 \
cargo run --bin kernel
```

Set `MINOOTS_BOOT_DEMO=1` to automatically schedule a demo timer when the kernel starts. Persistence and NATS publishing are
optional and enabled through the environment variables shown above.

## Next steps
- Replace JSON persistence with an append-only log or Postgres-backed store and add replay/compaction logic.
- Build clustering/failover semantics and timer catch-up after downtime.
- Surface execution results and orchestrator telemetry back through the kernel events/metadata.
