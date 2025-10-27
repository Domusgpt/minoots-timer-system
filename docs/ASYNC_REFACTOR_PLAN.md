# MINOOTS Ultimate Async Refactor Program

## 0. Executive Intent
Deliver a "mean, agent-first" horology fabric that fuses the existing control plane, Rust kernel, and orchestrator services into a telemetry-saturated, asynchronous platform for solo agents and orchestrated swarms. This program consolidates guidance from the reference architecture, development track, and prior planning docs into a single execution charter.

- **Outcome:** Durable, policy-aware timer orchestration capable of ±250 ms jitter across 1M concurrent timers, with streaming APIs and audit-ready telemetry.
- **Scope:** `apps/control-plane`, `services/horology-kernel`, `services/action-orchestrator`, `proto/`, SDKs, and supporting infrastructure.
- **Principles:** Contract-first design, async everything, observability by default, zero-trust multi-tenancy, and agent-centric ergonomics.

## 1. Baseline Reality Check
| Plane | Current State | Gaps to Close |
| --- | --- | --- |
| Control Plane | Express + Zod REST API with in-memory repo and kernel gateway. 【F:README.md†L81-L109】【F:docs/DEVELOPMENT_TRACK.md†L7-L35】 | Swap in durable persistence, add streaming interfaces (gRPC/MCP), embed RBAC and quota/policy enforcement, and propagate trace context. |
| Horology Kernel | Tokio scheduler with broadcast events and tonic gRPC; no durable state or clustering yet. 【F:services/horology-kernel/src/lib.rs†L1-L265】 | Introduce replicated persistence, deterministic timing wheel, Raft-based coordination, timer graph semantics, and telemetry hooks. |
| Event Fabric & Orchestrator | Node service consuming gRPC/NATS/STDIN, executing webhooks. 【F:services/action-orchestrator/src/index.ts†L1-L40】 | Standardize on JetStream/Kafka, formalize Action Bus (agent + workflow connectors), implement retries/DLQ and observability. |
| Client & SDK Surfaces | CLI/SDK prototypes with polling patterns. 【F:README.md†L93-L110】 | Async streaming subscriptions, trace propagation, and timer mutation primitives for agents. |
| Governance & Telemetry | Ad-hoc logging; no unified OTEL pipeline. 【F:docs/DEVELOPMENT_TRACK.md†L67-L71】 | Global tracing/metrics/logging, signed envelopes, audit ledger, SLA dashboards. |

## 2. Architecture End-State
1. **Agent-Centric Control Surface**
   - Fastify/NestJS gateway with REST, Connect/gRPC, SSE/WebSocket feeds, and MCP adapter built from the shared protobuf contract.
   - Policy wall enforcing RBAC, quotas, escrowed credentials, and tenant metadata injection before commands reach the kernel.
   - CQRS split: async command bus (JetStream/Kafka) on write path, query API on read path backed by Postgres read replicas + Elastic cache.

2. **Deterministic Horology Fabric**
   - Modular Rust crates (`scheduler-core`, `persistence`, `replication`, `api`, `telemetry`).
   - Hierarchical timing wheel + high-resolution priority queue with jitter monitors and drift compensation loops.
   - Raft/consensus replication and append-only command log (FoundationDB/Etcd + Postgres) powering snapshot + replay.
   - Temporal orchestration graphs: chained timers, escalations, dependencies, adaptive adjustments from agent callbacks.

3. **Event-Driven Execution Mesh**
   - Signed `EventEnvelope`s on JetStream/Kafka with schema registry + idempotency keys.
   - Action Orchestrator v2 with connector plugins (Webhook, Agent Command Bus, Workflow Runner, Human Notification) and ack SLAs.
   - Agent Command Bus bridging MCP, LangChain, AutoGen, vendor-specific APIs, and edge proxies with progress callbacks.
   - DLQs, replay tooling, chaos harness feeding telemetry dashboards.

4. **Observability & Governance Spine**
   - OpenTelemetry traces, metrics, and logs exported to Honeycomb/New Relic and Prometheus/Grafana.
   - Signed audit ledger with immutable timer lifecycle and policy decisions.
   - Timeline explorer API aggregating kernel + orchestrator telemetry for agents and operators.

5. **Async SDK & Tooling Ecosystem**
   - TypeScript/Python/Rust SDKs exposing async/await APIs, streaming subscriptions, offline buffering, and trace propagation.
   - CLI/MCP tools adopting contract-first timer definitions, interactive orchestration, and dev sandbox helpers.

## 3. Execution Program (12-Week Rolling Plan)
The roadmap is structured into four waves with explicit exit criteria and cross-team rituals. Parallelize work across Control Plane (CP), Kernel (HK), Execution Mesh (EM), and DevEx (DX) streams.

### Wave 0 – Stabilize Foundations (Weeks 0-2)
- CP: Introduce Postgres via Prisma/Drizzle; migrate timer repository + tests; add OTEL middleware + structured logs.
- HK: Extract persistence trait, wire Postgres/Etcd adapters behind async tasks; implement snapshot + restore smoke tests.
- EM: Stand up JetStream locally, refactor orchestrator to consume JetStream events, implement DLQ skeleton.
- DX: Document shared `.env`, docker-compose for Postgres + JetStream, and automated bootstrap script.
- **Exit Criteria:** End-to-end timer creation persists to Postgres, events emitted via JetStream, OTEL traces visible in local collector.

### Wave 1 – Distributed Kernel & Policy Wall (Weeks 3-6)
- CP: Add RBAC/quota middleware, tenant metadata propagation, and signed headers; expose Connect/gRPC streaming endpoints.
- HK: Integrate Raft leader election (openraft/async-raft), durable command log, deterministic state machine with timer states (Scheduled→Armed→Fired→Settled).
- EM: Implement action bundle schema registry + validation, add retry strategies + metrics.
- DX: Ship automated integration test harness hitting REST/gRPC + verifying JetStream deliveries; add chaos scripts (kernel restart, network jitter).
- **Exit Criteria:** Kernel cluster failover <2 s with no missed timers; control plane rejects unauthorized requests; integration suite green.

### Wave 2 – Agent Command Bus & Temporal Graphs (Weeks 7-10)
- CP: Timer chaining & escalation DSL persisted with definitions; SSE/WebSocket subscription APIs.
- HK: Timer graph executor enabling dependencies and adaptive extensions; jitter reporting + compensation tasks.
- EM: Agent Command Bus connectors (MCP, LangChain, AutoGen, Webhook v2) with acknowledgement workflows; progress callbacks.
- DX: Update SDKs + CLI to consume streaming feeds; publish reference agent playbooks + sandbox tutorials.
- **Exit Criteria:** Multi-agent swarm demo (trigger + ack), timer dependency scenario validated, SDK streaming clients stable.

### Wave 3 – Observability, Governance, Scale (Weeks 11-12+)
- CP/HK/EM: End-to-end OTEL dashboards, SLA enforcement, signed audit ledger, multi-tenant isolation tests.
- Platform: Terraform modules for multi-region deploy, load/perf benchmarks (1M timers, ±250 ms jitter), timeline explorer UI alpha.
- DX: Publish migration guide, run chaos/regression suite in CI nightly.
- **Exit Criteria:** Production readiness review with telemetry dashboards, governance policies, and scale test reports archived.

## 4. Workstream Backlogs & Owners
| Stream | Owner Skills | Epic Buckets | Key Deliverables |
| --- | --- | --- | --- |
| CP | Node/Fastify, auth, ops | Persistence, Policy Wall, Streaming APIs, Observability | Postgres adapters, RBAC/quota, Connect/gRPC endpoints, OTEL middleware |
| HK | Rust, distributed systems | Persistence, Replication, Temporal Graphs, Telemetry | Command log, Raft cluster, timing wheel, jitter monitors |
| EM | Node/Go, integrations | JetStream Fabric, Action Bus, Connectors, DLQ | JetStream consumer core, plugin SDK, agent connectors, replay tooling |
| DX | Polyglot, DX | SDKs, CLI, Sandbox, Docs | Async SDKs, CLI v2, devcontainer/docker-compose, timeline explorer spec |
| Governance | Security, ops | RBAC, Audit, Compliance | Signed envelopes, audit ledger, policy-as-code, compliance reports |

Backlogs should be managed in Linear/Jira with stories referencing this charter IDs (e.g., `CP-PERSIST-01`). Each story requires updated contracts/tests, telemetry coverage, and documentation checkpoints.

## 5. Dev Track Rituals & Cadence
- **Weekly Architecture Sync (Mon):** Review telemetry coverage, jitter metrics, and backlog burndown across streams.
- **Daily Swarm Standup (Async in #dev-horology):** Use devlog template to capture yesterday/today/risks, referencing story IDs.
- **Fortnightly Chaos Drill:** Run failure scenarios (clock skew, node loss, JetStream outage) and log outcomes in the devlog.
- **Quarterly Compliance Review:** Validate audit ledger, RBAC policies, and tenant isolation tests.

## 6. Dev Logging & Testing System (see `docs/DEVLOG_AND_TESTING_SYSTEM.md`)
- Adopt a repo-wide devlog captured in `docs/devlog/` with daily markdown entries per stream.
- Automated tests grouped into: unit (`npm test`, `cargo test`), integration (`npm run test:e2e`, `cargo test -- --ignored`), chaos (`scripts/chaos/*`), and load (`tests/load/*`).
- All PRs must link to a devlog entry, include telemetry screenshots or OTEL trace IDs, and pass contract/schema validation.
- Observability gating: merge blocked if new spans/metrics missing for touched components.

## 7. Immediate Kickoff Checklist (Week 0, Day 1)
1. Stand up `docker-compose.dev.yml` with Postgres, JetStream, and OTEL collector (DX-001).
2. Create persistence adapter tickets: `CP-PERSIST-01`, `HK-PERSIST-01`.
3. Configure repo automation: lint/test GitHub Actions, OTEL collector health check, devlog enforcement script.
4. Populate devlog Day 0 entry summarizing environment bring-up and telemetry validation.
5. Schedule Architecture Sync + Daily async standup (calendar invites + Slack channel).

## 8. Risks & Mitigations
- **Complex rollout sequencing:** Maintain feature flags + canary environments; require replayable migrations and rollback plans.
- **Telemetry overload / cost:** Sample non-critical traces, centralize metric cardinality review weekly.
- **Connector brittleness:** Contract tests + schema registry with compatibility checks in CI.
- **Raft operational risk:** Invest in chaos drills, automated snapshotting, and fallback queue to capture timers during failover.

## 9. Success Metrics & Exit Survey
- 99.95% timer delivery SLO, ±250 ms jitter P95, <1 s agent acknowledgment median.
- 100% services emitting OTEL traces + metrics with dashboard coverage.
- Agent satisfaction: ≥4.5/5 in monthly DX survey for streaming APIs + SDK ergonomics.
- Compliance: zero unresolved audit findings, signed envelope verification 100% pass.

---
This charter supersedes prior async refactor outlines and operationalizes the Development Track toward an agent-first, telemetry-heavy horology platform.
