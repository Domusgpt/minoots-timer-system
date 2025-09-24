# MINOOTS Agentic Horology Platform — Reference Architecture

## 1. Product Intention
MINOOTS must evolve from a single-process timer script into a **distributed horology fabric** that agent swarms, single autonomous agents, and human users can trust for long-horizon, interlinked work. Timers have to survive host failures, orchestrate follow-on actions, wake agents up with contextual commands, and remain observable/controllable through shared tooling that spans multiple LLM runtimes and orchestration frameworks.

## 2. Design Principles
1. **Agent-first contracts** – Timers expose structured intents (prompts, JSON directives, workflow handles) that language-model agents can consume without brittle scraping.
2. **Independent durability** – Timer execution outlives any particular client or orchestrator process. State persists across crashes, upgrades, and regional failures.
3. **Composable swarm orchestration** – Timers can target single agents or whole swarms, schedule chain reactions, and feed into higher-level planners like LangChain, AutoGen, Swarm.js, or MCP.
4. **Deterministic execution** – Trigger accuracy stays within sub-second tolerances even at scale. Event replay and idempotency are built in.
5. **Zero-trust multitenancy** – Teams, agents, and integrations coexist without leaking data. Every action is policy-checked and auditable.
6. **Ubiquitous integration** – The timing surface is reachable from CLIs, SDKs, MCP tools, REST/gRPC, WebSocket streams, and low-code builders.

## 3. Capability Targets
| Category | Minimum Viable Target | Mature Target |
| --- | --- | --- |
| Scale | 1M concurrently scheduled timers | 50M timers across 10 regions |
| Precision | ±250 ms trigger jitter | ±50 ms w/ drift compensation |
| Availability | 99.9% control-plane SLA | 99.99% control plane, 100% eventual execution |
| Security | SOC2-ready audit logs | FedRAMP/ISO options, signed commands |
| Agent Actions | Webhooks & CLI commands | Full agent-bridge, conversation replay, multi-agent fan-out |
| Observability | Timer logs & metrics | Global timeline explorer, predictive alerts |

## 4. High-Level Architecture
```
            ┌──────────────────────────┐
            │  Access Plane            │
            │  - REST / gRPC API       │
            │  - MCP / LangChain SDKs  │
            │  - CLI & Web Dashboard   │
            └────────────┬─────────────┘
                         │
             ┌───────────▼───────────┐
             │ Control Plane          │
             │ - AuthZ / RBAC         │
             │ - Timer Definition Svc │
             │ - Policy Engine        │
             │ - Event Schema Registry│
             └───────────┬───────────┘
                         │
             ┌───────────▼────────────┐        ┌────────────────────────┐
             │ Horology Kernel (Rust) │◀──────▶│ Distributed State Cache │
             │ - Durable Scheduler    │        │ (Redis/KeyDB Cluster)   │
             │ - Timing Wheel + PQ    │        └────────────────────────┘
             │ - Persistence Adapter  │
             └───────────┬────────────┘
                         │
      ┌──────────────────▼─────────────────────┐
      │ Event Fabric & Execution Plane         │
      │ - NATS JetStream / Kafka (ordered bus) │
      │ - Action Orchestrators (Node/Go)       │
      │ - Agent Command Bus (MCP, LLM APIs)    │
      │ - Dead-letter & Retry Queues           │
      └──────────────────┬─────────────────────┘
                         │
        ┌────────────────▼────────────────┐
        │ Agent & User Adapters          │
        │ - MCP Tools / Claude / OpenAI  │
        │ - LangChain, LlamaIndex, AutoGen│
        │ - Workflow runners (Temporal)  │
        │ - Human notification channels  │
        └─────────────────────────────────┘
```

### Control Plane
- **API Gateway** (TypeScript, Cloud Functions or Fastify service) terminates auth (Firebase, API keys, OAuth) and funnels requests.
- **Timer Definition Service** normalizes timer specs, validates SLA tier policies, and stores immutable definitions plus mutable runtime state in **PostgreSQL (CockroachDB)**.
- **Policy & RBAC Engine** enforces per-tenant quotas, secret-scoped credentials for outgoing actions, and per-agent access scopes.

### Horology Kernel
- Implemented in **Rust (Tokio)** for precise time handling, using a hybrid **hierarchical timing wheel + binary heap** for near/far timers.
- Holds an append-only log of timer lifecycle events (create/update/cancel/fire) persisted via **FoundationDB or PostgreSQL logical replication**.
- Replicated across regions using Raft (via **tonic + Raft** or **Etcd**) to achieve high availability. Heartbeats guarantee failover <2s.
- Exposes gRPC for scheduling commands and streams a **deterministic event feed** to the event fabric.

### Event Fabric & Execution Plane
- **NATS JetStream** (or Kafka) carries ordered timer events. Subjects include `timer.expired`, `timer.scheduled`, `timer.error`.
- **Action Orchestrators** (Node/Go workers) subscribe per tenant/tier to transform timer expirations into actions: HTTP requests, CLI commands, queue pushes, or agent wake-ups.
- **Agent Command Bus** wraps connectors to MCP servers, LangChain tool registries, AutoGen groups, and vendor APIs (OpenAI, Anthropic, Groq, Local LLMs). Commands are versioned JSON schemas.
- **Retry & DLQ** – Cloud Tasks/SQS for HTTP/webhook retries; separate topics for agent command replays.

### Adapters & Clients
- **SDKs** provide typed models and offline caching; CLI interacts with gRPC/REST.
- **MCP tool** exports timer creation, subscription, and cancellation for Claude Desktop.
- **Temporal/Prefect Plugins** allow timers to orchestrate workflows or be orchestrated by them.
- **Human Channels** integrate Slack/Discord bots and email/SMS via adapter microservices.

## 5. Core Domain Model
- `TimerDefinition`: immutable blueprint; includes schedule, jitter, recurrence, escalation policy, payload schema, security context.
- `TimerInstance`: runtime state machine (`scheduled → armed → firing → completed|failed|cancelled`).
- `ActionBundle`: ordered set of actions referencing connectors (webhook, command, agent_prompt, workflow_event).
- `AgentBinding`: describes which agent/swarm receives commands, along with credentials, fallback routing, and acknowledgement SLA.
- `EventEnvelope`: signed event record containing dedupe keys, trace ids, and data required for idempotent execution.

## 6. Timer Lifecycle Flow
1. **Create** – Request hits API → validated → stored in Postgres → command sent to Horology Kernel via gRPC.
2. **Schedule** – Kernel places timer in appropriate bucket; replicates command to cluster peers.
3. **Arm** – As trigger approaches, timer moves to high-resolution wheel; state mirrored to Redis cache for fast lookups.
4. **Fire** – On expiry, kernel emits `timer.expired` event to JetStream with ActionBundle payload.
5. **Execute** – Action Orchestrator consumes event, performs actions with distributed tracing context.
6. **Acknowledge** – Results (success/error) appended to event log, stored in Postgres, and optionally pushed to subscribers via WebSockets/Server-Sent Events.
7. **Escalate/Rerun** – On failure, policy decides between retry schedule, DLQ, or escalation (notify on-call, open ticket, ping agent swarm leader).

## 7. Agent Command Patterns
- **Direct Prompt Dispatch** – Timer event posts structured prompt to MCP/LLM endpoint; agent re-enters conversation with context, including timer metadata, logs, and attachments.
- **Swarm Broadcast** – Timer triggers `swarm.task_ready` command via Agent Bus; swarm orchestrator assigns to best-suited agent (skills-based routing).
- **Stateful Resume** – Timer holds serialized agent scratchpad in object storage; on fire, orchestrator loads scratchpad and resumes plan-of-record.
- **Feedback Loops** – Agents can call back into MINOOTS via SDK to reschedule timers, extend deadlines, or cancel chains.

## 8. Data Storage Strategy
- **PostgreSQL/CockroachDB** – Authoritative timer definitions, tenant metadata, audit logs.
- **FoundationDB (or Etcd)** – Strongly-consistent replication log for Horology Kernel commands.
- **Redis/KeyDB Cluster** – Hot cache for next 5 minutes of timers, rate limiting counters, agent handshake tokens.
- **Object Storage (GCS/S3)** – Large payloads, agent scratchpads, attachments.
- **BigQuery/Snowflake** – Analytics pipeline fed via event bus sink connectors.

## 9. Observability & Governance
- **OpenTelemetry** instrumentation across all services; exporters to Honeycomb/New Relic.
- **Structured Logging** with trace ids; logs shipped to Elastic or Loki.
- **Real-time Timeline Explorer** – UI surfaces aggregated timer states, jitter stats, and failure hotspots.
- **Compliance** – Signed event envelopes, immutable audit trail, role-based access, tenant-scoped encryption keys (KMS).

## 10. Resiliency Tactics
- Quorum-based scheduling writes; single region failure triggers automatic leader election.
- Graceful degradation: if event bus unavailable, kernel buffers expirations locally and replays when reconnected.
- Outgoing actions executed through **idempotent connectors** (webhook signature, command digest) to avoid duplication on retries.
- Chaos-testing harness injects clock skew, node loss, and slow consumers.

## 11. Implementation Roadmap (90-day)
1. **Weeks 1-3 – Kernel Foundation**
   - Stand up Rust scheduler prototype with Postgres backing and gRPC API.
   - Implement deterministic unit tests for timing accuracy and failover.
2. **Weeks 4-6 – Control Plane & Event Fabric**
   - Build TypeScript API gateway, auth/RBAC, timer definition flows.
   - Integrate NATS JetStream, create Action Orchestrator skeleton (webhook + command actions).
3. **Weeks 7-9 – Agent Bridge & SDKs**
   - Ship MCP tool + LangChain/LlamaIndex connectors; implement Agent Command Bus with vendor adapters (OpenAI, Anthropic, Groq, local models via LM Studio proxy).
   - Deliver TypeScript & Python SDKs with offline caching and CLI v2.
4. **Weeks 10-12 – Reliability & Analytics**
   - Add DLQs, retry policies, audit dashboards, global timeline UI.
   - Launch metrics stack (Prometheus/Grafana) and anomaly detection for timer drift.
5. **Weeks 13+ – Enterprise & Edge**
   - Multi-region deployment, per-tenant encryption, Terraform modules.
   - Edge timer node (WASM build) for air-gapped or on-prem swarm deployments.

## 12. Migration from Current Prototype
- Keep existing `independent-timer.js` as a **developer edge node**: refactor into a lightweight client that talks to the Horology Kernel instead of spawning detached scripts.
- Introduce migration scripts to import current JSON timer files into Postgres TimerDefinition/TimerInstance tables.
- Deprecate file-based background scripts once the distributed kernel is stable.

## 13. Open Questions
1. Do enterprise customers require **deterministic audit playback** (i.e., event sourcing) or is eventual consistency sufficient?
2. Should the Agent Command Bus support **bi-directional streaming** (agents streaming progress) or rely on callback timers?
3. How aggressively do we invest in **edge deployments** (on-premises, IoT) versus centralized cloud reliability for the first year?

---
**Outcome:** This architecture positions MINOOTS as the shared timing nervous system for agentic ecosystems—delivering durable, precise timers that can wake agents, coordinate swarms, and weave into any LLM framework without sacrificing reliability or governance.
