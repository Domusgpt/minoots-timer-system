# MINOOTS ⏱️

**Agent-first horology fabric for autonomous and swarm workloads**

MINOOTS provides a dedicated timer plane that agents and human operators can trust for long-running,
independent execution. The platform is organised into three cooperating services:

| Component | Path | Responsibility |
| --- | --- | --- |
| **Control Plane** | `apps/control-plane` | REST API that validates timer definitions, enforces tenant scoping, and forwards lifecycle commands to the kernel over gRPC. |
| **Horology Kernel** | `services/horology-kernel` | Rust scheduler that owns canonical timer state, exposes a tonic-powered gRPC API, and broadcasts lifecycle events. |
| **Action Orchestrator** | `services/action-orchestrator` | Streams kernel events (preferably over gRPC) and executes downstream actions such as webhooks or agent wake-up commands. |

Shared protobuf contracts live in [`proto/timer.proto`](proto/timer.proto) and are consumed by every
service. Design intent and rollout priorities are documented in [`AGENTIC_TIMER_ARCHITECTURE.md`](AGENTIC_TIMER_ARCHITECTURE.md)
and [`docs/PROJECT_PRIORITIES.md`](docs/PROJECT_PRIORITIES.md).

## Quick start

### 1. Prerequisites
- Node.js 18+
- Rust 1.75+
- `protoc` (for generating gRPC bindings)

### 2. Install dependencies
```bash
# Control plane
cd apps/control-plane
npm install

# Action orchestrator
cd ../../services/action-orchestrator
npm install

# Horology kernel
cd ../horology-kernel
cargo build
```

### 3. Run the stack locally
```bash
# Horology kernel (gRPC server on 0.0.0.0:50051)
cargo run --bin kernel

# Control plane REST API (uses KERNEL_GRPC_URL)
cd ../../apps/control-plane
KERNEL_GRPC_URL=localhost:50051 npm run dev

# Action orchestrator (subscribes to the kernel stream)
cd ../../services/action-orchestrator
KERNEL_GRPC_URL=localhost:50051 npm run dev
```

The control plane listens on `localhost:4000` and requires the `KERNEL_GRPC_URL` environment variable.
The orchestrator first attempts to connect to the same kernel stream before falling back to NATS or STDIN
for local experimentation.

### 4. Interact with the control plane
```bash
# Create a timer that fires after 30 seconds
curl -X POST http://localhost:4000/timers \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "demo-team",
    "requestedBy": "agent:planner",
    "name": "demo-timer",
    "duration": "30s",
    "metadata": { "intent": "demo" }
  }'

# List timers for a tenant
curl 'http://localhost:4000/timers?tenantId=demo-team'

# Cancel a timer (x-tenant-id header required)
curl -X POST http://localhost:4000/timers/<timerId>/cancel \
  -H 'Content-Type: application/json' \
  -H 'x-tenant-id: demo-team' \
  -d '{ "tenantId": "demo-team", "requestedBy": "agent:planner", "reason": "manual" }'
```

The orchestrator logs fired events and will execute webhook actions or emit agent prompts as they arrive.

## Horology kernel gRPC surface

The kernel exposes the `HorologyKernel` service defined in [`proto/timer.proto`](proto/timer.proto):

- `ScheduleTimer` – persist and arm a timer (duration or absolute `fire_time`).
- `ListTimers`/`GetTimer` – query canonical state for a tenant.
- `CancelTimer` – mark a timer terminal and broadcast cancellation metadata.
- `StreamTimerEvents` – subscribe to scheduled, fired, and cancelled events.

Clients can reuse the generated bindings in `services/horology-kernel/src/rpc.rs` or load the proto through
`@grpc/grpc-js` as the control plane and orchestrator do. Vendored Google well-known protos live under
`proto/google/protobuf` for toolchains that do not ship them.

## Quality & testing

The kernel crate ships unit tests for the scheduler and an end-to-end gRPC test that exercises scheduling,
firing, cancellation, and streaming semantics. Run the suite with:

```bash
cd services/horology-kernel
cargo test
```

Control-plane and orchestrator packages currently validate via `npm run build`; integration tests that
span the REST ↔ kernel ↔ orchestrator pipeline are called out as a near-term priority.

Refer to [`docs/PROJECT_PRIORITIES.md`](docs/PROJECT_PRIORITIES.md) for the durability, observability,
and reliability work that is planned next. Legacy CLI tooling remains in the repository for historical
reference but is no longer representative of the active architecture.
