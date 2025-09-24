# Engineering Priorities – April 2024 Snapshot

This document captures the current state of the MINOOTS timer platform and the highest-impact engineering priorities after
wiring the control plane, horology kernel, and action orchestrator together via gRPC.

## Repository reality check
- **Control plane** now schedules and cancels timers through the kernel's tonic gRPC APIs, eliminating the divergence that came
  from an in-memory repository stub.
- **Horology kernel** runs as a self-contained gRPC server that exposes scheduling, listing, cancellation, and streaming APIs.
  State still lives in memory, so durability remains the number-one gap.
- **Action orchestrator** consumes the kernel's streaming API directly (with NATS/STDIN fallbacks) and can execute webhook actions
  the moment timers fire or fail.
- **Legacy surface area** (the historical CLI, Firebase config, and optimistic docs such as `CURRENT_STATUS_SUMMARY.md`) remains in
  the repo and can confuse contributors. We should gradually archive or rewrite these artifacts.

## Progress in this iteration
- Delivered an end-to-end gRPC path: control plane → kernel → orchestrator, with consistent schema conversions on both sides.
- Normalized protobuf contracts (`proto/timer.proto`) so cancelled timers propagate reason/caller details and event streams carry
  failed timer data.
- Refreshed service docs and the development track to describe the real boot flow instead of the aspirational prototype.

## High-priority focus areas
1. **Durable persistence** – replace in-memory storage with Postgres (control plane) and an embedded store/replicated log in the
   kernel. Persistence unlocks restarts, audits, and historical queries.
2. **Contract + SDK alignment** – regenerate clients that talk to the new gRPC/REST surfaces and deprecate the file-based timer
   scripts that live at the repo root.
3. **Resilient event fabric** – push kernel events into JetStream/Kafka so orchestrators can scale horizontally and recover from
   disconnects without losing timer firings.
4. **Observability & governance** – add tracing, metrics, and structured audit trails before layering on billing or tier limits.
5. **Documentation cleanup** – archive outdated "production-ready" claims and consolidate guidance around the gRPC-driven stack.

## Tactical backlog (ordered)
1. Land database migrations + repository adapters in the control plane and verify they match kernel state.
2. Introduce a persistence module in the kernel (sled/sqlite/Postgres) and a snapshot/replay path for recovery.
3. Build a JetStream producer in the kernel and a consumer in the orchestrator to harden the event pathway.
4. Publish updated SDK/CLI packages that default to the control plane REST API and kernel gRPC stream.
5. Remove/retire legacy Firebase + Stripe code once equivalent capabilities exist on the new platform.
6. Add smoke/integration tests that spin up the kernel + control plane in-process and validate timer lifecycle flows.

## Documentation follow-ups
- Mark `CURRENT_STATUS_SUMMARY.md` and similar marketing collateral as historical, or move them into an `/archive` folder to avoid
  misleading contributors.
- Expand the service READMEs with troubleshooting sections (e.g., gRPC TLS, proto regeneration) once persistence lands.
- Keep `docs/DEVELOPMENT_TRACK.md` as the source of truth for phased execution and update it alongside major code changes.
