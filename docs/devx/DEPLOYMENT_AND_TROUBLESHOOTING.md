# MINOOTS deployment & troubleshooting guide

This guide documents how to deploy the MINOOTS timer system in production-like environments and what to do when things go wrong. It assumes familiarity with Node.js, Rust, PostgreSQL, and containerised workloads.

## 1. Architecture checkpoints

Before deploying, verify the following components are healthy in your target environment:

| Component | Purpose | Technology | Default entry point |
| --- | --- | --- | --- |
| Control plane | REST + gRPC gateway for creating, listing, and cancelling timers | Node.js (TypeScript, Express, Zod) | `apps/control-plane` (`npm run start`) |
| Horology kernel | Durable scheduler that keeps time, streams events, and powers gRPC methods | Rust (Tokio) | `services/horology-kernel` (`cargo run --release --bin kernel`) |
| Action orchestrator | Consumes kernel events and invokes webhooks / commands | Node.js | `services/action-orchestrator` (`npm run start`) |
| Postgres | Durable timer store | PostgreSQL 14+ | Connection string in `DATABASE_URL` |
| Optional surfaces | Slack bot, GitHub Action, Python toolkit | Node.js / GitHub Actions / Python | See respective directories |

## 2. Deployment prerequisites

1. **Infrastructure**
   - Managed PostgreSQL instance with backups enabled.
   - Container runtime or process supervisor (Docker, Kubernetes, systemd) for each service.
   - Ingress / load balancer terminating TLS for the control plane REST API.
2. **Configuration**
   - Create environment files based on `.env.example` in the repo root and `apps/control-plane/.env.example`.
   - Provision secrets for `DATABASE_URL`, `JWT_PUBLIC_KEY`, and any third-party webhooks triggered by the orchestrator.
   - Decide on a `KERNEL_GRPC_URL` reachable by both the control plane and orchestrator (cluster DNS or load-balanced endpoint).
3. **Build artefacts**
   - `apps/control-plane`: `npm install && npm run build`
   - `services/action-orchestrator`: `npm install && npm run build`
   - `services/horology-kernel`: `cargo build --release`

## 3. Deploying the core services

### Step 1 – Database preparation

Run the SQL migrations located in `apps/control-plane/prisma` (if using Prisma) or apply the schema using the provided migration scripts. Confirm the `timers` table contains JSONB columns for `metadata` and `labels`.

### Step 2 – Horology kernel

1. Deploy the compiled binary or container image.
2. Configure the environment:
   ```bash
   export KERNEL_GRPC_ADDR=0.0.0.0:50051
   export KERNEL_EVENT_TENANT_ID=__all__
   ```
3. Expose the gRPC port through your service mesh or load balancer.
4. Enable process supervision or Kubernetes `livenessProbe` to restart the kernel if it stops.

### Step 3 – Control plane

1. Deploy the built Node.js bundle.
2. Set environment variables:
   ```bash
   export DATABASE_URL="postgres://<user>:<pass>@<host>/<db>"
   export KERNEL_GATEWAY_MODE=grpc
   export KERNEL_GRPC_URL=<kernel-grpc-endpoint>
   export JWT_PUBLIC_KEY="$(cat path/to/public_key.pem)"
   ```
3. Run migrations (`npm run prisma:migrate`) during rollout.
4. Expose REST on port 4000 (or your override) behind HTTPS.

### Step 4 – Action orchestrator

1. Deploy alongside the control plane or as a separate workload.
2. Configure:
   ```bash
   export KERNEL_GRPC_URL=<kernel-grpc-endpoint>
   export KERNEL_EVENT_TENANT_ID=__all__
   export ACTION_WEBHOOK_TIMEOUT_MS=10000  # optional override
   ```
3. Ensure outbound network access to any webhook targets you intend to call.

### Optional surfaces

- **Slack bot (`apps/slack-bot`)** – Create a Slack app with slash command `/ato`, configure the signing secret and bot token in environment variables, and point `CONTROL_PLANE_URL` to the deployed REST endpoint.
- **GitHub Action (`github-actions/schedule-timer`)** – Publish to the GitHub Marketplace or reference via `uses: ./github-actions/schedule-timer` in workflows. Provide `token`, `timer_name`, and optional metadata inputs.
- **Python toolkit (`integrations/python/minoots_agent_tools`)** – Publish to an internal package index or install directly from the repo. Configure environment variables (`MINOOTS_API_URL`, `MINOOTS_API_KEY`) for agent runtimes.

## 4. Verification checklist

After deployment:

- Call `POST /api/timers` with a short-duration timer and confirm `GET /api/timers/:id` reflects status changes.
- Watch the kernel logs to ensure the timer enters the active queue and emits an expiration event.
- Confirm the orchestrator receives the event and executes the configured action (webhook/command/file write).
- Run `npm --prefix apps/control-plane test` or your CI suite to validate basic contracts after configuration changes.

## 5. Troubleshooting playbook

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| `POST /api/timers` returns 500 with `KernelUnavailable` | Control plane cannot reach the kernel gRPC endpoint | Verify `KERNEL_GRPC_URL`, security groups, and that the kernel process is healthy. Temporarily switch `KERNEL_GATEWAY_MODE=memory` to unblock tests. |
| Timer stays in `scheduled` state forever | Kernel process crashed or lacks persistence | Check kernel logs, ensure process supervisor restarts it, and confirm system clock accuracy. |
| Actions never fire | Orchestrator cannot stream events or outbound webhooks fail | Validate `KERNEL_GRPC_URL`, review orchestrator logs for webhook HTTP errors, and configure retries/backoff. |
| Slack `/ato` command returns 401 | Missing or invalid MINOOTS API credentials | Set `CONTROL_PLANE_API_KEY` (or JWT) in the Slack bot environment and confirm the control plane `JWT_PUBLIC_KEY`. |
| GitHub Action fails with `ECONNREFUSED` | Workflow runner cannot reach the control plane URL | Expose the control plane publicly or via GitHub self-hosted runners on the same network. |
| `python -m compileall integrations/python/minoots_agent_tools` fails | Missing Python dependencies | Run `pip install -r integrations/python/minoots_agent_tools/requirements.txt` or the extras defined in `pyproject.toml`. |

## 6. Operational tips

- Enable structured logging for each service (`LOG_LEVEL=info` or similar) and aggregate logs in a central system.
- Schedule regular load tests to measure drift and expiration accuracy.
- Use feature flags or tenant allow-lists when rolling out new orchestration actions.
- Keep the ecosystem metadata optional; base workflows do not require portfolio-specific context.

For deeper architectural context, consult `AGENTIC_TIMER_ARCHITECTURE.md` and the engineering milestones in `docs/DEVELOPMENT_TRACK.md`.
