# Platform Status & Priority Assessment (April 2024)

This document captures the current shape of the MINOOTS timer system after the gRPC-focused refactor
and identifies the highest-impact priorities to pursue next. It is meant to replace the outdated
"launch-ready" narratives elsewhere in the repository with an engineering-grounded snapshot that other
contributors can trust.

## Current Capabilities

- **Horology kernel** (`services/horology-kernel`)
  - Rust async scheduler with broadcast event fan-out and a fully implemented gRPC API
    (`ScheduleTimer`, `GetTimer`, `ListTimers`, `CancelTimer`, and server-side streaming events).
  - JSON serialization helpers normalize metadata, label maps, agent bindings, and action bundles so
    clients can pass arbitrary structures through the proto contract.
  - Integration tests (`tests/grpc.rs`) exercise schedule → list → cancel round-trips through the gRPC
    surface, catching regressions in protobuf compatibility.
- **Control plane** (`apps/control-plane`)
  - Express + Zod REST API that now proxies to the kernel via gRPC by default, with an in-memory fallback
    for local development or failure isolation.
  - Recursive timer action validation supports nested escalations and keeps TypeScript types aligned with
    the JSON payload expected by the kernel and orchestrator.
  - Build script verifies the TypeScript surface (`npm run build`).
- **Action orchestrator** (`services/action-orchestrator`)
  - Consumes kernel timer events over gRPC, NATS, or STDIN with schema validation and status normalization
    (including the proto's `FAILED` state).
  - TypeScript build passes after wiring in the gRPC client constructor typing and dependency installs.
- **Contracts & tooling**
  - `proto/timer.proto` now avoids Google well-known types in favour of plain strings/JSON, simplifying
    multi-language client generation.
  - README and development track docs document the shared `KERNEL_*` environment variables and JSON payload
    semantics so teams can run the stack consistently.

## Gaps & Risks

1. **Persistence** – The kernel remains in-memory only; a crash will drop timers. PostgreSQL or FoundationDB
   backends are the top requirement for reliability.
2. **Durable event delivery** – gRPC broadcast is best-effort. Without persistence, the orchestrator cannot
   resume missed events. JetStream/Kafka sinks and ack/retry plumbing are needed.
3. **Control-plane validation hardening** – There are no HTTP-level unit tests guarding the new gRPC gateway,
   JSON serialization helpers, or schema refinements.
4. **Observability & operations** – Logging exists but there is no tracing, metrics, or health/ready probes
   for the kernel gRPC surface.
5. **Documentation drift** – Legacy launch docs (e.g., `CURRENT_STATUS_SUMMARY.md`) misrepresent the actual
   capabilities and can mislead decision makers.

## Immediate Priorities (order of execution)

1. **Persist timers in the kernel** – Introduce a repository trait with a SQLite/Postgres implementation,
   covering schedule/get/list/cancel, and extend the gRPC integration test to restart the kernel and prove
   durability.
2. **Stabilize event delivery** – Add ack-aware streaming in the orchestrator (or swap to NATS JetStream)
   with backoff/DLQ behaviour so JSON parsing or executor failures do not silently drop work.
3. **Control-plane test harness** – Add lightweight unit tests for `mapTimer`, JSON helpers, and REST routes
   (using supertest) to lock in the new serialization rules and prevent regressions.
4. **Documentation cleanup** – Replace or archive legacy "launch" docs and converge everything on this
   status tracker plus the architecture blueprint in `AGENTIC_TIMER_ARCHITECTURE.md`.

## Secondary Roadmap

- Implement multi-tenant authentication/authorization once persistence lands.
- Expand the protobuf contract with explicit failure events and structured execution results.
- Package SDK stubs (TypeScript/Rust/Python) using the regenerated proto definitions.
- Stand up integration testing that drives the control plane REST API end-to-end through the kernel and
  orchestrator using docker-compose.

## Validation Checklist

- `npm run build` executed in both TypeScript services to confirm the new typings.
- `cargo test --manifest-path services/horology-kernel/Cargo.toml` green, covering unit and gRPC integration
  flows.

Contributors should treat this document as the source of truth for ongoing planning until a dedicated
product roadmap replaces it.
