# MINOOTS Control Plane

The control plane exposes REST endpoints for creating, listing, and cancelling timers. It is the entry point for agents,
SDKs, and human operators to manage timers that will be executed by the horology kernel.

## Features
- Validates timer definitions with Zod schemas and normalizes durations.
- Persists timer metadata using a repository abstraction (currently an in-memory store).
- Emits timer lifecycle commands to the horology kernel through a gRPC gateway.
- Provides tenant-aware APIs suitable for multi-tenant and swarm workloads.

## Endpoints
| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/timers` | Create a timer. Requires body with `tenantId`, `requestedBy`, and `duration` or `fireAt`. |
| `GET` | `/timers?tenantId=...` | List timers for a tenant. `tenantId` can also be provided via the `x-tenant-id` header. |
| `GET` | `/timers/:id` | Fetch a timer. Requires `x-tenant-id` header. |
| `POST` | `/timers/:id/cancel` | Cancel a timer. Requires `x-tenant-id` header and cancellation payload. |

Example request to create a timer:
```bash
curl -X POST http://localhost:4000/timers \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "demo-team",
    "requestedBy": "agent:planner",
    "name": "daily-report",
    "duration": "15m",
    "metadata": { "priority": "high" }
  }'
```

## Development
```bash
cd apps/control-plane
npm install
KERNEL_GRPC_URL=localhost:50051 npm run dev
```

The dev server runs on port `4000` and requires a running horology kernel gRPC server (see `services/horology-kernel`).

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `KERNEL_GRPC_URL` | `localhost:50051` | Address of the horology kernel gRPC endpoint. |

The in-memory repository remains available for caching and local smoke tests. Swap it for a persistent adapter (Postgres,
DynamoDB, etc.) once durability requirements are in scope.
