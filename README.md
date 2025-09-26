# MINOOTS ⏱️

**Durable timer foundations for agentic and automation workloads**

MINOOTS is an open prototype of a three-plane timer system: a REST control plane in
TypeScript, a Rust horology kernel that manages timer lifecycles, and an action
orchestrator that reacts to timer events. The current codebase is intentionally
minimal—it is meant for experimentation, not production—but now includes
persistence, gRPC wiring, and NATS-based event distribution so the full
architecture can be exercised locally.

## 📦 What ships today

| Component | Path | What it does now |
| --- | --- | --- |
| Control plane | `apps/control-plane` | Express + Zod REST API with gRPC client for the kernel. Supports in-memory storage by default or JSON file persistence via `TIMER_STORE_PATH`. |
| Horology kernel | `services/horology-kernel` | Tokio scheduler with optional on-disk recovery (`KERNEL_PERSIST_PATH`), gRPC surface, and NATS event publishing (`NATS_URL`). |
| Action orchestrator | `services/action-orchestrator` | Listens to timer events from NATS (or STDIN fallback) and executes webhook / agent actions. |
| Proto contracts | `proto/timer.proto` | Shared protobuf definition used by the control plane and kernel. |

### Key capabilities

- ✅ REST + gRPC: Create, list, get, and cancel timers over REST while the service
  proxies calls to the Rust kernel through gRPC.
- ✅ Durable storage: File-backed persistence for the control plane and kernel so
  timers survive process restarts when the relevant environment variables are set.
- ✅ Event fabric: The kernel publishes lifecycle events to NATS so the action
  orchestrator can execute follow-on work.
- ✅ Test coverage: Vitest suites exercise the control plane service (including a
  gRPC stub) and the Rust crate ships `cargo test` coverage for scheduling,
  cancellation, and proto conversions.

### Known limitations

- ❌ No multi-node or HA semantics—timers run in a single process.
- ❌ Persistence uses simple JSON files; Postgres/SQL backends are still on the
  backlog.
- ❌ Authentication relies on API keys loaded from configuration files or env,
  not a full identity provider.
- ❌ The orchestrator executes actions serially and lacks retry/circuit breaker logic.

## 🚀 Getting started locally

1. **Install prerequisites**
   - Node.js 18+
   - Rust 1.75+
   - A running NATS instance if you want real event streaming (optional)

2. **Install dependencies**
   ```bash
   cd apps/control-plane && npm install
   cd ../.. && cd services/action-orchestrator && npm install
   cd ../.. && cd services/horology-kernel && cargo build
   ```

3. **Prepare persistence (optional)**
   - Control plane: set `TIMER_STORE_PATH=/tmp/minoots-control-plane.json`
   - Kernel: set `KERNEL_PERSIST_PATH=/tmp/minoots-kernel.json`
   - API keys: create a JSON file `[ { "key": "mnt_example", "userId": "demo", "tier": "free" } ]`
     and point `API_KEYS_PATH` at it

4. **Start the services**
   ```bash
   # Rust kernel (will publish NATS events when NATS_URL is set)
   cd services/horology-kernel
   NATS_URL=nats://localhost:4222 \
   KERNEL_PERSIST_PATH=/tmp/minoots-kernel.json \
   cargo run --bin kernel

   # Control plane REST API (port 4000)
   cd ../.. && cd apps/control-plane
   TIMER_STORE_PATH=/tmp/minoots-control-plane.json \
   KERNEL_GRPC_ADDRESS=localhost:50051 \
   API_KEYS_PATH=../config/api-keys.json \
   npm run dev

   # Action orchestrator (listens to NATS)
   cd ../.. && cd services/action-orchestrator
   NATS_URL=nats://localhost:4222 npm run dev
   ```

5. **Create a timer**
   ```bash
   curl -X POST http://localhost:4000/timers \
     -H "Content-Type: application/json" \
     -H "X-API-Key: mnt_example" \
     -d '{
       "tenantId": "demo",
       "requestedBy": "cli",
       "name": "coffee-break",
       "duration": "30s",
       "metadata": {"note": "brew beans"}
     }'
   ```

   The kernel will persist the timer and publish lifecycle events to NATS.
   The orchestrator prints webhook execution logs when the timer fires.

## 🔌 Configuration reference

| Variable | Service | Purpose |
| --- | --- | --- |
| `TIMER_STORE_PATH` | Control plane | JSON file used for timer persistence. When unset, an in-memory map is used. |
| `KERNEL_GRPC_ADDRESS` | Control plane | Address of the running kernel gRPC server. Enables gRPC gateway when set. |
| `API_KEYS_PATH` / `API_KEYS_JSON` | Control plane | Sources API keys for authentication. Falls back to demo keys when unset. |
| `KERNEL_PERSIST_PATH` | Kernel | JSON file used to persist timer state between restarts. |
| `NATS_URL` | Kernel & orchestrator | Connection string for NATS. Enables event publishing/consumption. |
| `NATS_SUBJECT` | Kernel & orchestrator | Subject used for timer events (defaults to `minoots.timer.events`). |
| `MINOOTS_BOOT_DEMO` | Kernel | Boots a demo timer for smoke testing. |

## 🧪 Tests

- Control plane: `cd apps/control-plane && npm test`
- Horology kernel: `cd services/horology-kernel && cargo test`

The control plane test suite now spins up a temporary gRPC server to exercise the
TypeScript ↔ proto conversions. The kernel suite covers scheduling semantics,
persistence helpers, and JSON/protobuf conversions.

## 🛣️ Roadmap snapshot

1. **Database-backed persistence** – Swap JSON files for Postgres/SQLite adapters
   and snapshot/replay logic in the kernel.
2. **Stream processing hardening** – Add retry, DLQ, and delivery guarantees to
   the NATS event flow and orchestrator action execution.
3. **Auth & policy engine** – Replace static API keys with OAuth/Firebase and
   tenant-scoped quotas.
4. **Observability** – Ship OpenTelemetry spans + structured logging for all
   services and document dashboards.

See [`docs/ENGINEERING_PRIORITIES.md`](docs/ENGINEERING_PRIORITIES.md) for the
full backlog and status callouts.

## 🙌 Contributing

This project is under active iteration. Please open issues or PRs if you spot
bugs or want to propose enhancements. When changing the gRPC surface, update
`proto/timer.proto` and regenerate the Rust code via `cargo build` in the kernel
crate.
