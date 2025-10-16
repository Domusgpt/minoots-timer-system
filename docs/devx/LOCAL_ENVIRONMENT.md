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
3. `node services/action-orchestrator/scripts/ensure-jetstream.js`

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

If `KERNEL_STORE` is omitted or set to an unknown value the kernel falls back to the in-memory store.

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
- Inspect Postgres `timer_records` table to confirm persistence:

  ```bash
  docker exec -it minoots-postgres psql -U minoots -d minoots -c "SELECT id, tenant_id, status FROM timer_records;"
  ```
- Use `nats stream view MINOOTS_TIMER` to verify JetStream subjects and DLQ messages.

## 7. Cleanup
Tear down the infrastructure when finished:

```bash
docker compose -f docker-compose.dev.yml down
```

This environment baseline satisfies the Wave 0 exit criteria: durable timers in Postgres, JetStream fan-out, and OTEL traces collected locally.
