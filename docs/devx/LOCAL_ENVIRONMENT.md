# Local Environment Bootstrap for Wave 0

This guide covers the shared developer tooling introduced during Wave 0 of the async refactor. It explains how to launch the infrastructure stack, run migrations, and verify telemetry plumbing end-to-end.

## 1. Prerequisites
- Docker Desktop or Podman with Compose v2 support
- Node.js 18+
- Rust toolchain (1.75+) with `cargo`
- `npm install` executed for `apps/control-plane` and `services/action-orchestrator`

Copy the example environment file and tweak values as needed:

```bash
cp .env.example .env
```

## 2. Start the core services
Use the shared bootstrap script to start Postgres, NATS JetStream, and the OpenTelemetry collector, then run control-plane migrations and ensure JetStream streams exist.

```bash
./scripts/bootstrap-dev.sh
```

The script performs the following steps:
1. `docker compose -f docker-compose.dev.yml up -d`
2. `npm run db:migrate` within `apps/control-plane`
3. `npm run policy:seed` within `apps/control-plane` (ensures tenants, API keys, and quotas)
4. `node services/action-orchestrator/scripts/ensure-jetstream.js`

## 3. Running the control plane
The policy seed step provisions a default tenant (`tenant-local`) with API key `local-dev-key` and assigns timer quotas. You can override or extend the seed list by editing `CONTROL_PLANE_SEED_API_KEYS` in `.env`.

With infrastructure running, start the control plane (which now defaults to Postgres persistence and OTLP tracing):

```bash
cd apps/control-plane
npm run dev
```

Visit `http://localhost:4000/healthz` to confirm the service responds. Traces will be emitted to the local collector (logged to stdout by default).

## 4. Running the horology kernel
The kernel binary now auto-selects persistence based on `KERNEL_STORE`:

```bash
cd services/horology-kernel
KERNEL_STORE=postgres \
KERNEL_DATABASE_URL=postgres://minoots:development@localhost:5432/minoots \
  cargo run --bin kernel
```

If `KERNEL_STORE` is omitted or set to an unknown value the kernel falls back to the in-memory store.

### 4.1 Leadership coordination options

Wave 1 adds two leadership paths so the kernel can run in both lightweight and clustered modes:

1. **Postgres-backed coordinator (default)** – If `KERNEL_RAFT_NODE_ID` is _not_ set, the binary starts the new
   `PostgresRaftCoordinator`. Provide a unique `KERNEL_NODE_ID` plus heartbeat/election tuning before launch:

   ```bash
   export KERNEL_STORE=postgres
   export KERNEL_DATABASE_URL=postgres://minoots:development@localhost:5432/minoots
   export KERNEL_NODE_ID=kernel-local
   export KERNEL_RAFT_HEARTBEAT_MS=250
   export KERNEL_RAFT_ELECTION_TIMEOUT_MS=1500
   cargo run --bin kernel
   ```

   The coordinator persists its leadership claim in `kernel_raft_state`, allowing additional replicas to observe the current
   leader via Postgres even without the full Raft transport enabled.

   When the control plane calls a follower instance, the kernel now returns a `FAILED_PRECONDITION` gRPC status which the
   gateway surfaces as an HTTP `503 Service Unavailable` response. The API includes an optional `retryAfterMs` hint so clients
   (and agents) can back off until a new leader is elected. During local testing you can simulate this by starting two
   kernel binaries pointing at the same Postgres database, then stopping the leader and observing the failover message from the
   follower.

   Leadership activity is now traced via OpenTelemetry spans (`coordinator.election_round`, `coordinator.takeover`,
   `coordinator.heartbeat`). Metrics are exported at `KERNEL_METRICS_ADDR` (defaults to `0.0.0.0:9464`) using the Prometheus
   exposition format and include counters for election attempts, outcomes, heartbeat results, and leadership transitions.

   ```bash
   export KERNEL_METRICS_ADDR=0.0.0.0:9464
   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
   export KERNEL_OTEL_SERVICE_NAME=horology-kernel-dev
   cargo run --bin kernel
   ```

   With the kernel running you can verify telemetry quickly:

   ```bash
   curl -s http://localhost:9464/metrics | grep kernel_coordinator
   ```

2. **OpenRaft supervisor** – Set `KERNEL_RAFT_NODE_ID` (and optional peer settings) to start the HTTP-based Raft supervisor
   introduced earlier. The kernel exposes the internal Raft RPCs over HTTP (`/raft-vote`, `/raft-append`, `/raft-snapshot`) so
   additional nodes can join without bespoke wiring:

   ```bash
   export KERNEL_STORE=postgres
   export KERNEL_DATABASE_URL=postgres://minoots:development@localhost:5432/minoots
   export KERNEL_RAFT_NODE_ID=1
   export KERNEL_RAFT_ADDR=0.0.0.0:7207
   export KERNEL_RAFT_PEERS=1=http://127.0.0.1:7207
   export KERNEL_RAFT_ELECTION_MIN_MS=300
   export KERNEL_RAFT_ELECTION_MAX_MS=600
   export KERNEL_RAFT_HEARTBEAT_MS=100
   cargo run --bin kernel
   ```

   Additional nodes can be added by extending `KERNEL_RAFT_PEERS` with comma-separated `id=url` pairs
   (for example `1=http://127.0.0.1:7207,2=http://127.0.0.1:7208,3=http://127.0.0.1:7209`). Launch each kernel with a unique
   `KERNEL_RAFT_NODE_ID` and `KERNEL_RAFT_ADDR`, reusing the shared Postgres store. The first node to boot successfully
   initialises the cluster; followers detect the leader through the HTTP RPCs and will automatically assume leadership when the
   active node shuts down **as long as quorum is maintained**. For OpenRaft this means running at least three nodes for
   continuous availability—two-node clusters cannot elect a new leader once one member is offline. Metrics and leadership
   transitions continue to appear on the standard `/metrics` endpoint so the Phase 1 harness and Prometheus dashboards can observe
   both coordinator modes.

## 5. Running the action orchestrator
With JetStream available, the orchestrator automatically consumes from the durable consumer and publishes to the DLQ on failures:

```bash
cd services/action-orchestrator
npm run dev
```

Set `NATS_JETSTREAM_STREAM`, `NATS_JETSTREAM_CONSUMER`, and `NATS_DLQ_SUBJECT` in `.env` to match the bootstrap defaults.
Use the DLQ utility to inspect or replay failed events:

```bash
npm run dlq:inspect # or dlq:replay
```

## 6. Telemetry verification
- Check collector logs (`docker logs minoots-otel-collector`) for OTLP spans.
- Hit the metrics endpoint exposed by the kernel (`curl -s http://localhost:9464/metrics | head`) to confirm election/heartbeat
  counters are present.
- Inspect Postgres `timer_records` table to confirm persistence:

  ```bash
  docker exec -it minoots-postgres psql -U minoots -d minoots -c "SELECT id, tenant_id, status FROM timer_records;"
  ```
- Use `nats stream view MINOOTS_TIMER` to verify JetStream subjects and DLQ messages.

## 7. Phase 1 integration harness

Wave 1 introduces an end-to-end harness (`tests/phase1/runHarness.ts`) that exercises the control plane against Postgres and the
gRPC gateway. The script loads `.env` (falling back to `.env.example`), truncates Postgres tables between phases, and verifies:

- REST timer CRUD + quota enforcement
- gRPC `ScheduleTimer` against the gateway using the shared protobuf contract
- HTTP follower behaviour (simulated) returning `503` with `Retry-After`
- **New:** Postgres-backed kernel cluster failover by launching two `cargo run --bin kernel` processes, forcing the leader to
  step down, and confirming the follower assumes leadership while the Prometheus metrics endpoint continues to expose
  `kernel_coordinator` counters

Run the harness after migrations complete:

```bash
NODE_PATH=$PWD/apps/control-plane/node_modules \
TS_NODE_PROJECT=apps/control-plane/tsconfig.json \
DATABASE_URL=postgres://minoots:development@localhost:5432/minoots \
node -r ts-node/register/transpile-only \
     -r ./scripts/ts-node-preload.js \
     tests/phase1/runHarness.ts
```

The preload script (`scripts/ts-node-preload.js`) extends `NODE_PATH` and adds CommonJS default shims for `@grpc/grpc-js` and
`@grpc/proto-loader`, matching the behaviour of the compiled gateway. When the command completes you should see logs for HTTP,
gRPC, follower, and kernel cluster checks (including kernel stdout/stderr) along with quota enforcement output. Because the
harness now spawns Rust binaries directly, ensure the kernel can be built (`cargo run --bin kernel`) before executing the
script to avoid compilation delays mid-run.

## 8. Cleanup
Tear down the infrastructure when finished:

```bash
docker compose -f docker-compose.dev.yml down
```

This environment baseline satisfies the Wave 0 exit criteria: durable timers in Postgres, JetStream fan-out, and OTEL traces collected locally.
