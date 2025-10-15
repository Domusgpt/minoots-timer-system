# MINOOTS Async-First Refactor Blueprint

## 1. Objectives
- Rebuild the timer platform around asynchronous, event-driven primitives across control, kernel, and execution planes.
- Embed telemetry, tracing, and governance so the platform can act as a durable nervous system for autonomous agents.
- Support both solo-agent and multi-agent orchestration with temporal coordination independent of downstream model stacks.

## 2. Current Landscape Assessment
- **Control plane** already validates timers and exposes REST endpoints with an in-memory repository, making it a natural host for async HTTP + gRPC gateways once persistence is swapped in.【F:apps/control-plane/README.md†L1-L33】【F:docs/DEVELOPMENT_TRACK.md†L8-L32】
- **Horology kernel** provides a Tokio-based scheduler with broadcast channels and a gRPC surface, establishing a solid async core that needs durable storage, clustering, and richer state semantics.【F:services/horology-kernel/README.md†L1-L20】【F:services/horology-kernel/src/lib.rs†L1-L213】
- **Action orchestrator** consumes events via gRPC, NATS, or STDIN with Zod validation, demonstrating pluggable async transports that must evolve into a fully instrumented execution plane for agent commands.【F:services/action-orchestrator/README.md†L1-L22】【F:services/action-orchestrator/src/infra/eventSource.ts†L1-L214】
- The reference architecture already calls for distributed state, event fabrics, and agent bridges, which the refactor should operationalize with opinionated defaults and progressive hardening.【F:AGENTIC_TIMER_ARCHITECTURE.md†L1-L184】

## 3. Target Architecture Enhancements
### 3.1 Async Control Plane
1. **Adopt Fastify or Express with async middleware** wired to an event loop-friendly ORM (Prisma/SQLx via Neon) for Postgres/Cockroach to replace the in-memory repository.【F:AGENTIC_TIMER_ARCHITECTURE.md†L48-L87】
2. **Dual-protocol gateway**: keep REST while adding gRPC + MCP endpoints that stream responses using async iterators/WebSockets, ensuring timer definitions and commands can be issued from agents in real time.【F:AGENTIC_TIMER_ARCHITECTURE.md†L13-L46】
3. **Policy + workflow engine**: introduce async hooks for rate limiting, policy checks, and workflow chain generation (e.g., hooking timers to Temporal or Prefect) executed via background workers.
4. **Telemetry-first HTTP stack**: integrate OpenTelemetry middleware, async request IDs, structured logging, and metrics exports to align with the "trace everything" expectation.【F:docs/DEVELOPMENT_TRACK.md†L58-L74】

### 3.2 Horology Kernel Evolution
1. **Async persistence layer**: replace the HashMap state with an actor-based repository (e.g., FoundationDB, Postgres logical log) using Tokio tasks to manage replication and checkpointing while preserving deterministic scheduling.【F:services/horology-kernel/src/lib.rs†L97-L213】
2. **Cluster orchestration**: embed Raft/consensus via async streams (e.g., tonic + etcd) so timers replicate across nodes; design leader election and failover windows under 2s as defined in resiliency tactics.【F:AGENTIC_TIMER_ARCHITECTURE.md†L88-L161】
3. **Temporal orchestration**: add hierarchical timing wheels with async state machines that promote timers into high-resolution buckets, supporting chained timers, recurrence, and escalation policies.
4. **Telemetry + control hooks**: expose async command channels for pausing/resuming timers, injecting drift corrections, and streaming state snapshots into the observability pipeline (OpenTelemetry metrics + structured events).【F:AGENTIC_TIMER_ARCHITECTURE.md†L162-L184】

### 3.3 Event Fabric & Orchestrators
1. **Standardize on NATS JetStream / Kafka** with async consumers that handle ordered delivery, backpressure, and replay; define DLQs and retry policies for webhook/agent failures.【F:AGENTIC_TIMER_ARCHITECTURE.md†L92-L132】
2. **Multi-agent command bus**: formalize action bundles into versioned JSON schemas and route them through connectors for MCP, LangChain, AutoGen, and custom agent swarms using async pipelines with acknowledgement SLAs.【F:services/action-orchestrator/src/infra/eventSource.ts†L36-L144】【F:AGENTIC_TIMER_ARCHITECTURE.md†L115-L152】
3. **Execution telemetry**: instrument each action with distributed traces, capturing latency, retries, and agent acknowledgements; push aggregates to the control plane timeline explorer.
4. **Edge-friendly adapters**: design WASM/Node edge workers that subscribe to the event fabric asynchronously, enabling offline execution or on-prem swarms to participate in orchestration.【F:AGENTIC_TIMER_ARCHITECTURE.md†L185-L240】

### 3.4 Client & SDK Surface
1. **Async-native SDKs** in TypeScript and Python, using streaming APIs for timer status and event subscriptions; align CLI tooling with these abstractions for consistent behavior.【F:README.md†L1-L83】【F:AGENTIC_TIMER_ARCHITECTURE.md†L133-L168】
2. **Declarative agent contracts**: expose builder APIs for defining agent prompts, scratchpad resumes, and swarm broadcasts; embed automatic timer rescheduling hooks for agents to call back into the system.【F:AGENTIC_TIMER_ARCHITECTURE.md†L133-L175】
3. **Telemetry propagation**: ensure SDKs carry trace context headers and support pluggable logging sinks so agent hosts can integrate with their observability stacks.

## 4. Refactor Workstreams
1. **Persistence & State (Weeks 1-4)**
   - Implement Postgres persistence in control plane with async repositories and migrations.
   - Introduce durable storage in the kernel with async replication and event sourcing.
   - Deliver integration tests that simulate failover and verify jitter bounds.
2. **Event Fabric & Agent Bus (Weeks 3-6)**
   - Stand up JetStream/Kafka infrastructure, convert orchestrator to async consumers with telemetry.
   - Implement action bundle schema registry and connectors for MCP/OpenAI/Claude, verifying fan-out scenarios.
3. **Telemetry & Governance (Weeks 2-6)**
   - Instrument all services with OpenTelemetry traces, metrics, and structured logs flowing to Honeycomb/Grafana.
   - Add RBAC, audit trails, and policy enforcement hooks in control plane and orchestrator.
4. **Temporal Intelligence (Weeks 5-8)**
   - Extend kernel to support chained timers, recurrence, and drift compensation.
   - Create planner services that schedule dependent timers based on agent feedback loops.
5. **Client Experience (Weeks 4-9)**
   - Release async SDKs and CLI v2 with streaming status.
   - Publish MCP tool updates that leverage the control plane gRPC streams for agent orchestration.

## 5. Deliverables & Exit Criteria
- End-to-end async pipelines from REST/gRPC request to kernel to event fabric with durable persistence and failover tests.
- Observability dashboards showing timer lifecycle, action execution, and agent acknowledgements with OpenTelemetry data.
- Multi-agent orchestration demos (swarm wake-up, solo agent resume) validated through integration scenarios.
- Migration guide for existing scripts to the new async-first platform, including import tooling and backwards-compatible SDK shims.

## 6. Risks & Mitigations
- **Clock drift & precision** → Introduce distributed clock sync (Chrony/TrueTime) and monitor jitter via telemetry to trigger recalibration jobs.【F:AGENTIC_TIMER_ARCHITECTURE.md†L161-L184】
- **Agent connector diversity** → Maintain a schema registry and contract tests for each adapter to avoid breaking orchestrations when APIs change.【F:AGENTIC_TIMER_ARCHITECTURE.md†L115-L152】
- **Operational complexity** → Provide Terraform/Helm modules and golden paths for deploying kernel clusters, event fabrics, and observability stacks.
- **Data governance** → Enforce tenant isolation with per-tenant encryption keys, signed event envelopes, and audit replay tooling as outlined in the architecture principles.【F:AGENTIC_TIMER_ARCHITECTURE.md†L145-L184】

## 7. Next Steps
- Validate roadmap with stakeholders, then spin up dedicated repos or subpackages for persistence adapters, telemetry stack, and agent connectors.
- Establish weekly architecture reviews to track async performance, telemetry coverage, and orchestration capabilities.
- Prototype multi-agent scheduling scenarios using the current kernel + orchestrator to benchmark improvements before refactor landing.
