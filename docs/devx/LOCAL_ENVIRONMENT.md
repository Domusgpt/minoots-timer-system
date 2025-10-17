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
2. `npm run db:migrate` within `apps/control-plane` (creates timer + raft persistence tables including `kernel_raft_log` and `kernel_raft_metadata`)
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

### 4.2 Event envelope signing

Wave 1 adds signed event envelopes so downstream consumers can discard spoofed timer events. The kernel and action orchestrator
derive their HMAC signatures from a shared secret. Set `EVENT_ENVELOPE_SECRET` (or `KERNEL_ENVELOPE_SECRET`) in your `.env`
before launching either service:

```bash
export EVENT_ENVELOPE_SECRET=$(openssl rand -hex 32)
```

The orchestrator reads the same variable and verifies every JetStream/gRPC event before executing actions. When the secret is
missing both services fall back to a well-known development default, which is convenient for quick smoke tests but should not
be used outside of local workspaces.

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

2. **OpenRaft supervisor** – Set `KERNEL_RAFT_NODE_ID` (and optional peer settings) to start the HTTP-based Raft supervisor
   introduced earlier:

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
   (for example `1=http://10.0.0.5:7207,2=http://10.0.0.6:7207`). The first node bootstraps the membership set and publishes
   leadership updates through the shared `LeaderHandle`, enabling the control plane to forward timer commands only to the active
   leader.

## 5. Running the action orchestrator
With JetStream available, the orchestrator automatically consumes from the durable consumer and publishes to the DLQ on failures:

```bash
cd services/action-orchestrator
npm run dev
```

Set `NATS_JETSTREAM_URL` (or `NATS_URL`), `NATS_JETSTREAM_STREAM`, `NATS_JETSTREAM_CONSUMER`, and `NATS_DLQ_SUBJECT` in `.env` to match the bootstrap defaults.
When these variables are present, the horology kernel publishes signed `TimerEventEnvelope` JSON directly to `NATS_SUBJECT`, letting any JetStream consumer verify HMAC signatures before executing actions.
Use the DLQ utility to inspect or replay failed events:

```bash
npm run dlq:inspect # or dlq:replay
```

## 6. Telemetry verification
- Check collector logs (`docker logs minoots-otel-collector`) for OTLP spans.
- Inspect Postgres `timer_records` table to confirm persistence:

  ```bash
  docker exec -it minoots-postgres psql -U minoots -d minoots -c "SELECT id, tenant_id, status FROM timer_records;"
  ```
- Verify Raft durability by inspecting `kernel_raft_log` and the metadata snapshot:

  ```bash
  docker exec -it minoots-postgres psql -U minoots -d minoots \
    -c "SELECT log_index, entry FROM kernel_raft_log ORDER BY log_index;"
  docker exec -it minoots-postgres psql -U minoots -d minoots \
    -c "SELECT vote, committed, snapshot_meta FROM kernel_raft_metadata;"
  ```
- Confirm OTEL spans are flowing for raft persistence by tailing the collector logs and
  filtering for the `horology.kernel.raft.*` span names:

  ```bash
  docker logs minoots-otel-collector | grep "horology.kernel.raft"
  ```
- Use `nats stream view MINOOTS_TIMER` to verify JetStream subjects and DLQ messages.
- Inspect live payloads with `nats subscribe minoots.timer.fired` and confirm the envelopes include `signature_version` and match the configured `EVENT_ENVELOPE_SECRET`.

## 7. Cleanup
Tear down the infrastructure when finished:

```bash
docker compose -f docker-compose.dev.yml down
```

This environment baseline satisfies the Wave 0 exit criteria: durable timers in Postgres, JetStream fan-out, and OTEL traces collected locally.

## 8. Postgres-backed test harness

Kernel tests that exercise Postgres persistence (command log + restore flows) expect a `TEST_DATABASE_URL`
to be present. Copy the connection string from `.env` or `.env.example` and export it before running
`cargo test` so SQLx can migrate and reuse the same containerized database:

```bash
export TEST_DATABASE_URL=postgres://minoots:development@localhost:5432/minoots
cargo test --manifest-path services/horology-kernel/Cargo.toml
```

The helper in `services/horology-kernel/src/test_support.rs` falls back to `DATABASE_URL` if the test-specific
variable is not set, but defining `TEST_DATABASE_URL` keeps local development isolated from any other Postgres
instances you may have running.

The restart harness also verifies that the Postgres command log captures lifecycle events after a kernel reboot.
Inspect the entries with psql to confirm both the `fire` and `settle` commands were recorded for the restored timer:

```bash
docker exec -it minoots-postgres psql -U minoots -d minoots \
  -c "SELECT command, timer_id, tenant_id FROM timer_command_log ORDER BY id;"
```
