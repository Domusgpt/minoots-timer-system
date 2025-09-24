# MINOOTS Development Track

This development track turns the agentic horology architecture into a working product by aligning day-to-day engineering
workflows with the new control, kernel, and execution planes. It introduces the initial service code, documents how to run
it locally, and lays out the phased backlog that the team can execute immediately.

## 1. Track Objectives
- Ship a **runnable control plane** that accepts timer definitions, normalizes agent payloads, and exposes observable REST/gRPC
  hooks for external tooling.
- Bring up a **durable horology kernel skeleton** in Rust that can manage timer lifecycles, emit events, and act as the single
  source of truth for timer state.
- Stand up an **action orchestrator** and **event fabric adapter** that translate timer expirations into webhook calls and agent
  wake-up commands.
- Enable a **developer feedback loop** with repeatable local environments, integration contracts, and test plans that evolve
  toward the multi-region target platform.

## 2. Workstream Map
| Plane | Owner Skills | Core Repositories | Immediate Focus |
| --- | --- | --- | --- |
| Control Plane (TypeScript/Node) | API, auth, product engineers | `apps/control-plane` | CRUD timers, validation, policy hooks, REST + future gRPC gateway |
| Horology Kernel (Rust) | Systems, distributed systems | `services/horology-kernel` | In-memory scheduler, event stream, persistence adapters |
| Event Fabric & Orchestrators (TypeScript) | Integrations, reliability | `services/action-orchestrator` | NATS topic listeners, action runners, retries |
| Shared Contracts | Polyglot | `proto/`, `docs/` | Timer protobuf, JSON schemas, test harness |
| Client Surfaces | SDK & DX engineers | `sdk/`, future `apps/dashboard` | CLI/MCP integrations, telemetry |

## 3. Sprint 0 (Foundations) Deliverables
The repository now contains the baseline code required to launch the platform locally:
- **Control Plane service** (`apps/control-plane`) with Express + Zod validation, a timer service layer, and an in-memory
  repository ready to swap for Postgres.
- **Horology Kernel crate** (`services/horology-kernel`) implementing an async scheduler with Tokio, broadcast timer events, and
  cancellation semantics.
- **Action Orchestrator service** (`services/action-orchestrator`) that listens to timer events, performs HTTP/webhook actions,
  and records execution traces.
- **Shared protobuf** (`proto/timer.proto`) describing the kernel RPC surface and event envelopes.

Each of these deliverables includes inline documentation and starter scripts so that contributors can run them immediately.

## 4. Execution Timeline
| Week | Milestone | Key Tasks |
| --- | --- | --- |
| 0 | Bootstrap | Wire repositories locally, smoke-test timer creation & expiry end-to-end, document telemetry/logging strategy |
| 1-2 | Persistence Integration | Replace in-memory repositories with Postgres adapters, add migrations, enforce tenant scoping |
| 3-4 | Event Fabric Hardening | Introduce JetStream/Kafka integration, implement retries + DLQs, and stress test timer throughput |
| 5-6 | Agent Bridge | Connect MCP/LangChain adapters, support structured agent commands, implement acknowledgement SLAs |
| 7-8 | Observability & Governance | Add OpenTelemetry spans, audit trails, RBAC, and compliance workflows |

## 5. Local Development Workflow
1. **Install toolchains** – Node.js 18+, pnpm or npm, Rust 1.75+, and `protoc` for protobuf generation.
2. **Bootstrap dependencies** – From the repo root run `npm install` (existing CLI) and install per-service dependencies:
   - `cd apps/control-plane && npm install`
   - `cd services/action-orchestrator && npm install`
   - `cd services/horology-kernel && cargo build`
3. **Run the stack locally**
   - Control plane: `npm run dev` inside `apps/control-plane` (listens on `localhost:4000`).
   - Horology kernel: `cargo run --bin kernel` (binds a gRPC listener at `0.0.0.0:50051` by default; override with `KERNEL_GRPC_ADDR`).
   - Action orchestrator: `npm run dev` inside `services/action-orchestrator` (subscribes to gRPC via `KERNEL_GRPC_URL`, then falls back to NATS or STDIN).
   - Before starting, export the shared kernel settings so every service resolves the same endpoint:
     ```bash
     export KERNEL_GRPC_URL=localhost:50051
     export KERNEL_GATEWAY_MODE=grpc
     export KERNEL_EVENT_TENANT_ID=__all__
     ```
   - Use the CLI (`independent-timer.js`) or HTTP calls to create timers and observe events flowing through the services.
4. **Testing cadence** – Each service ships its own unit tests (`npm test` / `cargo test`). Scenario tests in `tests/` will evolve
   to orchestrate the full workflow once persistence is wired up.

## 6. Contribution Expectations
- **Contracts first** – Update `proto/timer.proto` and any JSON schemas before shipping behavior changes. Regenerate stubs in
  service packages and SDKs.
- **Trace everything** – Instrument new code paths with OpenTelemetry spans and structured logs to feed the observability stack.
- **Deterministic timers** – Always assert jitter bounds and test failure paths (cancel, extend, failover) before merging.
- **Docs with code** – Every substantial change to behavior must update the relevant section in `docs/` or the service-specific
  READMEs so downstream teams stay aligned.

## 7. Next Steps
- Flesh out Postgres migrations and repository adapters in the control plane.
- Implement persistence + replication modules in the horology kernel to store timer logs durably.
- Connect the action orchestrator to managed NATS JetStream (or Kafka) and add templated agent bridge commands.
- Publish updated SDKs that target the new control plane endpoints and event stream, replacing direct file-system timers.

This track ensures the architecture ships as a cohesive product rather than a static plan—giving agents, users, and developers
an immediately useful foundation to build on.
