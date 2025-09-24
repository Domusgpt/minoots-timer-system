# Project Status & Priority Assessment

## Current State Snapshot
- **Horology kernel (`services/horology-kernel`)** now exposes a gRPC surface that schedules, cancels, lists, and streams timer
  events while maintaining the in-memory scheduler used in Sprint 0.
- **Control plane (`apps/control-plane`)** speaks to the kernel exclusively over gRPC, normalising timer payloads, caching
  results locally, and providing multi-tenant REST APIs.
- **Action orchestrator (`services/action-orchestrator`)** can stream kernel events directly via gRPC, with fallbacks to NATS or
  STDIN for local testing.
- **Legacy CLI & docs** (`independent-timer.js` and large README sections) still describe the pre-platform file-based timers and
  need consolidation with the new architecture.

## High-Impact Priorities
1. **Durable persistence & replay** – Replace in-memory stores with Postgres (control plane) and a replicated kernel log so the
   gRPC surface is backed by persistent state.
2. **Timer state synchronisation** – Introduce authoritative replication (e.g. CDC or kernel event sourcing) so control-plane
   caches and orchestrators always converge on the kernel’s truth.
3. **Event fabric hardening** – Move beyond STDIN/NATS dev modes to managed JetStream/Kafka with retries, DLQs, and idempotent
   action execution.
4. **Agent bridge integrations** – Implement MCP/LangChain/AutoGen adapters that consume kernel events and honour acknowledgement
   SLAs defined in the proto contract.
5. **DX alignment** – Keep public-facing docs and examples focused on the gRPC-based architecture (root README now reflects this)
   while providing a deprecation path for the legacy CLI utilities.

## Work Landed in This Iteration
- Implemented the kernel gRPC server (Schedule/Get/List/Cancel/Stream) with protobuf-driven conversions.
- Added a TypeScript gRPC gateway so the control plane stores, lists, and cancels timers through the kernel instead of in-memory
  scaffolding.
- Wired the action orchestrator to the same gRPC stream while preserving NATS/STDIN fallbacks for local development.
- Landed an end-to-end kernel gRPC test that exercises scheduling, firing, cancellation, and streaming semantics.
- Updated the root README, service documentation, and the development track to reflect the new integration points and
  environment variables.

## Recommended Next Steps
1. Design and implement the persistent timer store (schema, migrations, and kernel replay logic).
2. Extend the new kernel gRPC test into multi-service contract coverage (REST control plane ➜ kernel ➜ orchestrator) and gate changes in CI.
3. Define the event delivery guarantees (at-least/at-most/exactly once) and codify retry/backoff behaviour across kernel and orchestrator.
4. Trim or archive legacy CLI documentation and move developers toward the control plane SDK/HTTP surface backed by the kernel.
5. Publish a lightweight TypeScript/Go SDK that targets the new gRPC-powered control plane so agents can integrate without shelling out to the legacy CLI.
