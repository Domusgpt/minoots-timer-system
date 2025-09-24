# Horology Kernel

The horology kernel is the durable scheduling core for MINOOTS. It is implemented in Rust to provide deterministic timers,
low jitter, and resilient eventing for agent workloads.

## Capabilities in this foundation
- Asynchronously schedules timers with millisecond precision using Tokio.
- Exposes tonic gRPC APIs for scheduling, listing, cancelling, and streaming timer events.
- Emits lifecycle events (scheduled, fired, cancelled, failed) to subscribers.
- Supports cancellation semantics with tenant scoping and reason tracking.
- Provides unit tests that demonstrate timer firing and cancellation behavior.

## Running locally
```bash
cd services/horology-kernel
cargo run --bin kernel
```

Set `MINOOTS_BOOT_DEMO=1` to automatically schedule a demo timer when the kernel starts. Override `KERNEL_GRPC_ADDR` to bind to a
different interface/port. The binary now exposes the gRPC surface defined in `proto/timer.proto`; clients (control plane,
orchestrator, SDKs) connect directly to this server.

## Next steps
- Swap the in-memory map for FoundationDB/Postgres-backed storage.
- Implement durable event forwarding (NATS JetStream/Kafka) alongside the in-process stream.
- Add leader election and shard assignments so multiple kernels cooperate safely.
