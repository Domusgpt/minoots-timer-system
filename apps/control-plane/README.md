# MINOOTS Control Plane

The control plane exposes REST endpoints for creating, listing, and cancelling timers. It is the entry point for agents,
SDKs, and human operators to manage timers that will be executed by the horology kernel.

## Features
- Validates timer definitions with Zod schemas and normalizes durations.
- Persists timer metadata using a repository abstraction (currently an in-memory store).
- Emits timer lifecycle commands to the horology kernel through a pluggable gateway (gRPC when configured, in-process noop otherwise).
- Provides tenant-aware APIs suitable for multi-tenant and swarm workloads.

## Endpoints
| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/timers` | Create a timer. Requires body with `tenantId`, `requestedBy`, and `duration` or `fireAt`. |
| `GET` | `/timers?tenantId=...` | List timers for a tenant. `tenantId` can also be provided via the `x-tenant-id` header. |
| `GET` | `/timers/:id` | Fetch a timer. Requires `x-tenant-id` header. |
| `POST` | `/timers/:id/cancel` | Cancel a timer. Requires `x-tenant-id` header and cancellation payload. |

Example request to create a timer:
```bash
curl -X POST http://localhost:4000/timers \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "demo-team",
    "requestedBy": "agent:planner",
    "name": "daily-report",
    "duration": "15m",
    "metadata": { "priority": "high" }
  }'
```

## Development
```bash
cd apps/control-plane
npm install
npm run dev
```

The dev server runs on port `4000`.

### Talking to the Rust Horology Kernel

- Ensure the kernel is running: `cd ../../services/horology-kernel && cargo run --bin kernel`.
- Export the gRPC address before starting the control plane (the kernel listens on `127.0.0.1:50051` by default):
  ```bash
  export KERNEL_GRPC_ADDRESS="127.0.0.1:50051"
  export KERNEL_PROTO_PATH="$(pwd)/../../proto/timer.proto" # optional if repo layout is unchanged
  npm run dev
  ```
- When the address is not provided the service falls back to the `NoopKernelGateway`, allowing local development without the kernel.

Swap `InMemoryTimerRepository` for a real persistence adapter (e.g., Postgres) when you're ready to store timers durably.
