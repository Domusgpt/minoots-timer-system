# MINOOTS Engineering Priorities & Findings

_Last updated: 2025-07-14_

This document captures the current state of the repository after wiring the Rust horology kernel's gRPC surface to the TypeScript
control plane, highlights the most pressing product gaps, and calls out the next engineering moves required to make the
"agent-first horology" vision real. Treat it as the truth source for platform readiness until a more formal roadmap replaces it.

## 1. Reality Check: What Actually Works Today

| Area | Current Status | Risks / Notes |
| --- | --- | --- |
| Control Plane (`apps/control-plane`) | Express service with Zod validation, file-backed persistence (`TIMER_STORE_PATH`), configurable API key auth, and a gRPC-aware kernel gateway. Vitest suites cover service logic plus gRPC conversion stubs. | Needs real database adapter, integration tests against a live kernel, and stronger auth/quotas. |
| Horology Kernel (`services/horology-kernel`) | Tokio scheduler with optional JSON persistence (`KERNEL_PERSIST_PATH`), gRPC server, broadcast events, and NATS publishing when `NATS_URL` is set. | Still single-node, single-process. Persistence is JSON-only and lacks replay/compaction. No clustering/failover. |
| Action Orchestrator (`services/action-orchestrator`) | Subscribes to NATS subjects (or STDIN) and executes webhook/agent actions with structured logging. | Lacks retries, DLQ handling, and telemetry back into the control plane. |
| Shared Contracts (`proto/`) | `timer.proto` + vendored Google protos compile for Rust and load for TS. | Any contract change must regenerate Rust (`build.rs`) and update TS loaders manually; no automation yet. |

**Key takeaway:** the repo is a runnable prototype. Documentation in the root repo still advertises a production-ready SaaS, but
only the foundational services exist. Future work should treat the marketing copy as aspirational until the engineering backlog
below is delivered.

## 2. Work Finished in This Iteration

- Added a file-backed timer repository to the control plane (`TIMER_STORE_PATH`) and configurable API key loading
  via `API_KEYS_PATH` / `API_KEYS_JSON`.
- Extended Vitest coverage with a stubbed gRPC kernel server to validate schedule/list parity and timestamp conversions.
- Introduced `HorologyKernel::with_persistence` to reload timers from disk and re-arm pending expirations.
- Wired the kernel to publish timer events to NATS (guarded by `NATS_URL`), aligning the action orchestrator with
  real kernel events.
- Updated documentation (`README.md`, `CURRENT_STATUS_SUMMARY.md`) to reflect the prototype reality instead of
  production marketing copy.

## 3. Highest-Priority Engineering Tasks

1. **End-to-End Integration Coverage (Critical)**
   - Spin up the kernel + control plane in tests (or docker-compose) and exercise REST → gRPC → kernel → NATS → orchestrator.
   - Add contract tests for the streaming gRPC endpoint and tenant/topic filtering.

2. **Persistent Storage Upgrade (High)**
   - Land a Postgres (or SQLite) adapter for the control plane timer repository with migrations and tests.
   - Replace the kernel's JSON files with an append-only log + compaction strategy and verify restart semantics.

3. **Reliability & Telemetry (High)**
   - Implement retries/backoff + DLQ handling in the orchestrator and surface execution results via events/APIs.
   - Introduce OpenTelemetry traces/log schema shared across services.

4. **Auth & Policy Hardening (High)**
   - Swap static API keys for a real identity provider and persist rate-limit counters.
   - Document tenant quotas and wire usage reporting to the control plane.

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
