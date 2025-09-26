# MINOOTS Current Status — Prototype with Durable Foundations

_Last updated: 2025-07-14_

## ✅ What works today

### Control Plane (TypeScript)
- Authenticated REST API backed by Express + Zod validation.
- gRPC gateway talks to the Rust kernel; Vitest suite stubs the kernel to
  validate proto conversions.
- Persistence via `TIMER_STORE_PATH` file store (defaults to in-memory).
- Tier-based rate limiting seeded by configurable API keys (`API_KEYS_PATH` or
  `API_KEYS_JSON`).

### Horology Kernel (Rust)
- Tokio scheduler with gRPC server (`cargo run --bin kernel`).
- Optional JSON persistence (`KERNEL_PERSIST_PATH`) reloads timers on restart and
  re-arms pending expirations.
- Publishes timer lifecycle events to NATS when `NATS_URL` is configured.
- Broadcast event channel powers local subscribers and the NATS bridge.

### Action Orchestrator (TypeScript)
- Subscribes to NATS subjects (falls back to STDIN) and executes webhook / agent
  actions when timers fire.
- Structured logging via Pino to trace execution.

### Developer Experience
- `README.md` now documents the true prototype state and configuration knobs.
- Unit tests: `npm test` for the control plane, `cargo test` for the kernel.
- Proto contracts shared via `proto/timer.proto`.

## ⚠️ Gaps & Risks

1. **Persistence Depth** – JSON files are single-node only; Postgres/SQLite
   adapters and kernel snapshot/replay logic are required before production use.
2. **Reliability** – No clustering, failover, or delayed job catch-up beyond the
   single process restart path.
3. **Security** – API keys are configurable but there is no user management UI,
   Stripe billing, or SSO integration despite previous marketing claims.
4. **Orchestrator Hardening** – Actions run sequentially without retries or
   circuit breakers; no telemetry is fed back to the control plane.
5. **Observability** – No OpenTelemetry, tracing aggregation, or metrics exports
   exist yet.

## 🎯 Immediate Priorities

1. **Database-backed persistence**
   - Implement Postgres adapters for the control plane repository.
   - Introduce durable storage + replay in the kernel (append-only log or
     snapshots) and corresponding tests.

2. **End-to-end event validation**
   - Add integration tests that start the kernel + control plane together,
     schedule timers over REST, and assert NATS events / orchestrator execution.
   - Exercise the streaming gRPC endpoint in automated tests.

3. **Reliability & retries**
   - Add retry/backoff policies to orchestrator actions and surface execution
     outcomes back to the kernel/control plane.
   - Define dead-letter queues or compensating workflows for failed actions.

4. **Auth & quotas**
   - Replace static keys with a hosted identity provider (Firebase/Auth0) and
     persist rate-limit counters.
   - Document tenant-level quotas and surface usage metrics.

5. **Observability**
   - Add structured tracing (OpenTelemetry in Rust, OTLP exporters in Node).
   - Provide dashboards/log sinks for timer lifecycle visibility.

## 📌 Operational Checklist (still pending)

- [ ] Automated proto regeneration scripts.
- [ ] Docker-compose / devcontainer for running the full stack locally.
- [ ] CI coverage for `npm test`, `cargo test`, and linting.
- [ ] Documentation for deploying NATS + persistence in staging.

## 📣 Callouts

The repository should no longer be described as "production ready" in investor or
marketing materials. Treat it as a solid prototype with real durability hooks,
ready for the next engineering push toward managed storage, observability, and
enterprise-grade auth.
