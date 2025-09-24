# MINOOTS Engineering Priorities & Findings

_Last updated: 2025-07-14_

This document captures the current state of the repository after wiring the Rust horology kernel's gRPC surface to the TypeScript
control plane, highlights the most pressing product gaps, and calls out the next engineering moves required to make the
"agent-first horology" vision real. Treat it as the truth source for platform readiness until a more formal roadmap replaces it.

## 1. Reality Check: What Actually Works Today

| Area | Current Status | Risks / Notes |
| --- | --- | --- |
| Control Plane (`apps/control-plane`) | Express service with Zod validation, in-memory persistence, and a pluggable kernel gateway. Now ships a gRPC-aware gateway (`GrpcKernelGateway`) but still depends on environment variables for a running kernel. | No auth, quotas, or real storage. REST tests only cover the in-memory/noop path. |
| Horology Kernel (`services/horology-kernel`) | Tokio-based scheduler with broadcast events. gRPC server compiles, converts domain ↔ proto types (including nested escalations), and unit tests cover scheduling, cancellation, duplicate protection, and action conversion. | Kernel is single-node and volatile (in-memory HashMap). No persistence, clustering, or crash recovery. |
| Action Orchestrator (`services/action-orchestrator`) | Can read timer events (STDIN/NATS stubs) and execute webhook/agent actions. | Not yet wired to the kernel's event stream. Needs durable event source and execution telemetry. |
| Shared Contracts (`proto/`) | `timer.proto` + vendored Google protos compile for Rust and load for TS. | Any contract change must regenerate Rust (`build.rs`) and update TS loaders manually; no automation yet. |

**Key takeaway:** the repo is a runnable prototype. Documentation in the root repo still advertises a production-ready SaaS, but
only the foundational services exist. Future work should treat the marketing copy as aspirational until the engineering backlog
below is delivered.

## 2. Work Finished in This Iteration

- Fixed the Rust kernel build by updating `BroadcastStream` handling, protobuf conversions, and JSON struct mapping to
  `prost_types::Struct`'s `BTreeMap` requirements.
- Added a regression test (`timer_action_proto_roundtrip_preserves_escalations`) guaranteeing nested escalation actions convert
  to/from protobuf safely.
- Ensured `cargo fmt` + `cargo test` succeed for the kernel crate, and `npm run build` + `npm test` succeed for the control
  plane.
- Hardened TypeScript ↔ gRPC translations inside `GrpcKernelGateway`, covering timestamps, JSON metadata, and retry policy shapes.

This unblocks end-to-end experiments once someone stands up the kernel binary and points the control plane at it via
`KERNEL_GRPC_ADDRESS`.

## 3. Highest-Priority Engineering Tasks

1. **Ship an End-to-End gRPC Path (Critical)**
   - Stand up the kernel gRPC server (`cargo run --bin kernel`) in local/dev envs.
   - Extend control-plane integration tests (Vitest) to stub the gRPC client and assert conversion parity, including
     missing metadata/labels and multi-layer escalations.
   - Add a happy-path integration test that boots the kernel in-process during tests (Tokio runtime) and exercises
     schedule → list → cancel via the REST API.
   - Wire streaming (`StreamTimerEvents`) to a consumer test to validate tenant/topic filtering logic.

2. **Replace In-Memory State With Durable Persistence (High)**
   - Introduce a Postgres adapter for `TimerRepository` and corresponding persistence inside the kernel (start with a
     single-node append-only log + periodic snapshots).
   - Migrate existing tests to run against an ephemeral Postgres (e.g., `docker compose` or `testcontainers`).
   - Design the replication path so the kernel can recover on restart (persist timers, replay outstanding ones).

3. **Connect the Action Orchestrator (High)**
   - Emit kernel events over NATS/JetStream (or another broker) and subscribe from the orchestrator.
   - Define action result reporting so the kernel/control plane can surface execution outcomes.
   - Add retries, circuit breakers, and telemetry around outbound HTTP/agent calls.

## 4. Supporting Initiatives

- **Contract Hygiene:** automate protobuf generation (Rust + TS) in CI, and document the command in `docs/DEVELOPMENT_TRACK.md`.
- **Observability & Operations:** add tracing/logging scaffolds (OpenTelemetry in Rust + Pino/OTLP in TS). Create a shared
  logging schema for timer lifecycle events.
- **Documentation Cleanup:** reconcile `README.md`, `CURRENT_STATUS_SUMMARY.md`, and other marketing-heavy files with the real
  engineering status to avoid misleading stakeholders.
- **Security/Posture:** once persistence lands, introduce authn/authz, rate limiting, and tenant isolation policies before any
  external exposure.

## 5. Next Check-In

When the next engineer picks this up, update this file with:
- Actual integration test coverage numbers.
- Decision on persistence technology (Postgres vs. other).
- Status of orchestrator wiring and any blockers discovered.

Keeping this snapshot fresh is the fastest way to turn the architectural vision into a dependable platform.
