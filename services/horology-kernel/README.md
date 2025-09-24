# Horology Kernel

The horology kernel is the durable scheduling core for MINOOTS. It is implemented in Rust to provide deterministic timers,
low jitter, and resilient eventing for agent workloads.

## Capabilities in this foundation
- Asynchronously schedules timers with millisecond precision using Tokio.
- Emits lifecycle events (scheduled, fired, cancelled) via a broadcast channel for downstream orchestrators.
- Supports cancellation semantics with tenant scoping.
- Provides unit tests that demonstrate timer firing and cancellation behavior.

## Running locally
```bash
cd services/horology-kernel
cargo run --bin kernel
```

Set `MINOOTS_BOOT_DEMO=1` to automatically schedule a demo timer when the kernel starts. In a production deployment this binary
will expose gRPC endpoints defined in `proto/timer.proto` and replicate state across nodes.

## Next steps
- Swap the in-memory map for FoundationDB/Postgres-backed storage.
- Expose the scheduling APIs over tonic gRPC and integrate with the control plane.
- Stream events into NATS JetStream instead of the local broadcast channel.
