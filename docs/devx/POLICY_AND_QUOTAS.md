# Control Plane Policy Wall

Phase 1 introduces the RBAC, quota, and request-signing layer enforced by the control plane before commands reach the kernel.
This document explains how to configure policies for local development and how the enforcement pipeline behaves.

## Configuration Files

Policies are loaded from one of two sources:

1. `POLICY_CONFIG_JSON` – inline JSON string (useful for CI).
2. `POLICY_CONFIG_PATH` – path to a JSON file (defaults to `apps/control-plane/config/policies.example.json`).

The schema is defined in `apps/control-plane/src/types/auth.ts` and supports:

- `signingSecret` – required for signature generation on outbound gRPC metadata.
- `defaultQuotas` – fallback quota limits per tenant.
- `tenants[]` – array of tenant policies, each containing `apiKeys[]` entries.

### Example snippet

```json
{
  "signingSecret": "local-dev-signing-secret",
  "defaultQuotas": {
    "maxActiveTimers": 100,
    "schedulePerMinute": 60,
    "cancelPerMinute": 120
  },
  "tenants": [
    {
      "tenantId": "development",
      "quotas": {
        "maxActiveTimers": 200
      },
      "apiKeys": [
        {
          "keyId": "dev-local",
          "principalId": "developer",
          "roles": ["developer"],
          "permissions": [
            "timers:create",
            "timers:read",
            "timers:cancel",
            "timers:stream"
          ],
          "hashedSecret": "<sha256 hash of the API key>"
        }
      ]
    }
  ]
}
```

Use `node apps/control-plane/scripts/hash-secret.js <plain-text>` (see below) to generate the `hashedSecret` field.

## Request Flow

1. The `AuthorizationMiddleware` extracts `x-tenant-id` and API credentials (`x-api-key` header or `Authorization: Bearer`).
2. `PolicyEngine.authorize` resolves the tenant policy, validates the secret using constant-time comparison, and returns an
   `AuthContext` containing roles, permissions, and effective quotas.
3. Permission checks occur per route. Scheduling and cancelling also invoke the `QuotaMonitor` to enforce rate/active-count limits.
4. When requests target the kernel, signed metadata is attached via `signKernelRequest` in `utils/signature.ts`. Downstream
   services can validate signatures using the shared `signingSecret`.

## Quota Enforcement

- `schedulePerMinute` / `cancelPerMinute` – sliding-window counters stored per principal in Postgres.
- `maxActiveTimers` – uses `TimerRepository.countActiveByTenant` for live enforcement.
- Exceeding a quota triggers HTTP 429 with a descriptive message.

To reset counters during local testing run:

```bash
psql $DATABASE_URL -c "DELETE FROM timer_command_log;"
```

## Developer Utilities

- `apps/control-plane/config/policies.example.json` – permissive defaults for the `development` tenant.
- `apps/control-plane/scripts/hash-secret.js` – helper to hash API secrets when defining new principals.

Update `.env` to point at a custom config file or inline JSON when testing multi-tenant scenarios.
