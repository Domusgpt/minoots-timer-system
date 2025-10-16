# Local Environment Bootstrap (Wave 0 → Wave 1)

This guide covers the shared developer tooling introduced during Wave 0 and extended in Wave 1 of the async refactor. It explains how to launch the infrastructure stack, run migrations, exercise the policy wall, and verify telemetry plumbing end-to-end.

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
3. `node services/action-orchestrator/scripts/ensure-jetstream.js`
4. `node apps/control-plane/scripts/hash-secret.js local-dev-key` if you need to regenerate policy secrets

## 3. Running the control plane
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

The kernel now emits a single-node Raft leadership view and appends every command to the Postgres-backed log. If `KERNEL_STORE` is omitted or set to an unknown value the kernel falls back to the in-memory store.

> For chaos testing, use `scripts/chaos/kernel_faults.sh restart|latency` to bounce the service or introduce artificial jitter while observing recovery behaviour.

## 5. Running the action orchestrator
With JetStream available, the orchestrator automatically consumes from the durable consumer and publishes to the DLQ on failures:

```bash
cd services/action-orchestrator
npm run dev
```

Set `NATS_JETSTREAM_STREAM`, `NATS_JETSTREAM_CONSUMER`, and `NATS_DLQ_SUBJECT` in `.env` to match the bootstrap defaults. The orchestrator now exposes Prometheus metrics on `METRICS_PORT` (default `9100`). Add the following scrape job to your Prometheus configuration:

```yaml
- job_name: minoots-action-orchestrator
  static_configs:
    - targets: ['localhost:9100']
```

Use the DLQ utility to inspect or replay failed events:

```bash
npm run dlq:inspect # or dlq:replay
```

## 6. Policy wall & quota verification

- Update `apps/control-plane/config/policies.example.json` or point `POLICY_CONFIG_PATH` at your own tenant definitions.
- Verify RBAC by calling the control plane with/without required permissions (403) and quotas (429).
- Use `node apps/control-plane/scripts/hash-secret.js <secret>` to derive hashes for new API keys.

## 7. Telemetry verification
- Check collector logs (`docker logs minoots-otel-collector`) for OTLP spans.
- Inspect Postgres `timer_records` table to confirm persistence:

  ```bash
  docker exec -it minoots-postgres psql -U minoots -d minoots -c "SELECT id, tenant_id, status FROM timer_records;"
  ```
- Use `nats stream view MINOOTS_TIMER` to verify JetStream subjects and DLQ messages.
- Hit `http://localhost:9100/metrics` (or your configured `METRICS_PORT`) to confirm orchestrator metrics exposure.

## 8. Integration harness

Run the Wave 1 integration harness once the control plane, kernel, orchestrator, and JetStream are online:

```bash
TEST_API_KEY=local-dev-key TEST_TENANT_ID=development npm run test:wave1
```

The harness schedules timers via REST and gRPC, awaits a JetStream event, and reports results as structured JSON.

## 9. Cleanup
Tear down the infrastructure when finished:

```bash
docker compose -f docker-compose.dev.yml down
```

This environment baseline satisfies the Wave 0 exit criteria: durable timers in Postgres, JetStream fan-out, and OTEL traces collected locally.
