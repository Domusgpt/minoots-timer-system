# MINOOTS Ecosystem Metadata Contract

This document captures the canonical shape of the `ecosystem` payload that now flows through the MINOOTS control plane, gRPC kernel, Slack surface, Python toolkit, and GitHub Action. The goal is to make it obvious how MINOOTS timers can stay in sync with the surrounding Parserator, Reposiologist, Nimbus Guardian, and Clear Seas Solutions launches that are already live or in soft launch.

The contract is intentionally lightweight: everything is optional, but downstream tooling expects at least one integration slug **or** a shared narrative/sync marker so timers remain discoverable in analytics.

## Top-level structure

```jsonc
{
  "ecosystem": {
    "parserator": { /* Parserator section */ },
    "reposiologist": { /* Reposiologist section */ },
    "nimbusGuardian": { /* Nimbus Guardian section */ },
    "clearSeas": { /* Clear Seas section */ },
    "sharedNarrative": "Parse → Plan → Ship",   // optional portfolio headline
    "nextSyncIso": "2025-11-01T17:00:00Z"       // optional ISO8601 sync cadence
  }
}
```

Timers carry this payload in `metadata.ecosystem`. The control plane sanitises it with Zod, projects curated labels (for example `ecosystem.parserator/dataset`), and preserves it end-to-end so Postgres persistence and gRPC responses expose the same structure.

## Section reference

| Section | Purpose | Key fields | Source inspiration |
| --- | --- | --- | --- |
| `parserator` | Connects timers to structured data recipes running in Parserator. | `workspaceId`, `datasetId`, `recipeSlug`, `callbackUrl`, `confidenceThreshold`, `autopilotMode` | [parserator.com](https://parserator.com) launch copy & docs |
| `reposiologist` | Links cadence timers with Reposiologist sweeps and clause packs. | `repositoryUrl`, `branch`, `sweepCadence`, `auditFocus`, `clausePack` | [reposiologist-beta.web.app](https://reposiologist-beta.web.app) beta UI |
| `nimbusGuardian` | Flags deployment gates that Nimbus Guardian enforces. | `policyId`, `environment`, `gateLevel`, `runbookUrl`, `enableSecretScan` | [nimbus-guardian.web.app](https://nimbus-guardian.web.app) product tour |
| `clearSeas` | Captures client engagement context from Clear Seas Solutions. | `engagementId`, `partnerPod`, `serviceTier`, `liaison`, `cadence` | [domusgpt.github.io/ClearSeas-Enhanced/](https://domusgpt.github.io/ClearSeas-Enhanced/) company overview |
| `sharedNarrative` | Short headline that unifies the timer with the broader campaign. | Free-form string | Portfolio messaging decks |
| `nextSyncIso` | When the next cross-product sync is expected to happen. | ISO 8601 timestamp | GTM and community operations calendars |

All fields are optional. MINOOTS only persists non-empty values, trims whitespace, and discards empty objects.

## Surfaces that understand the contract

- **REST / gRPC control plane** – `POST /timers` accepts the `ecosystem` object. Responses echo the sanitised payload and surface curated labels such as `ecosystem.sources`, `ecosystem.parserator/dataset`, and `ecosystem.nimbusGuardian/policy`.
- **Slack `/ato` command** – Flags like `--parserator '{"datasetId":"safety-audit"}'` or `--ecosystem-narrative 'Parse → Plan → Ship'` hydrate the same structure. The Slack bot sets the `x-minoots-region` header automatically when you pass `--region`.
- **Python `MinootsClient`** – The client’s `schedule_timer` method takes an `ecosystem` dict and merges it with provided labels so agents can align Parserator runs or Nimbus Guardian gates before starting workflows.
- **GitHub Action** – `with: ecosystem-json: '{"reposiologist":{"sweepCadence":"weekly"}}'` sends the payload during CI automation. The action also accepts `ecosystem-shared-narrative` and `ecosystem-next-sync-iso` inputs for documentation runs.

## Analytics & labelling

When an ecosystem payload is present the control plane projects a set of labels that downstream dashboards can rely on:

| Label | Value |
| --- | --- |
| `ecosystem.sources` | Count of populated integration sections (`parserator`, `reposiologist`, `nimbusGuardian`, `clearSeas`). |
| `ecosystem.parserator/workspace` | Parserator workspace slug when provided. |
| `ecosystem.reposiologist/cadence` | Sweep cadence (`daily`, `weekly`, etc.). |
| `ecosystem.nimbusGuardian/gate` | Deployment gate level (`advisory` or `enforced`). |
| `ecosystem.clearSeas/tier` | Clear Seas service tier (`discovery`, `pilot`, `retainer`). |
| `ecosystem.nextSyncIso` | Timestamp string so dashboards can filter upcoming syncs. |

Additional labels are emitted whenever string fields are present (for example `ecosystem.reposiologist/repository`). Consumers should treat them as hints rather than strict schema guarantees.

## Implementation checkpoints

1. **Validation** – `apps/control-plane/src/types/ecosystem.ts` defines the shared Zod schema. It now accepts either integration details or standalone narrative/sync markers so documentation-only timers remain valid.
2. **Persistence** – `apps/control-plane/src/store/postgresTimerRepository.ts` embeds the payload into `metadata` before writing to Postgres and rehydrates it on reads. In-memory repositories already operate on the same object graph.
3. **Gateways** – `apps/control-plane/src/services/kernelGateway.ts` and the Slack/Python surfaces automatically parse metadata and attach labels, so no additional client work is required when the schema evolves.

## Example: Parserator + Nimbus Guardian + Clear Seas

```json
{
  "tenantId": "portfolio-demo",
  "name": "launch-readiness",
  "duration": "2h",
  "ecosystem": {
    "parserator": {
      "workspaceId": "parserator-beta",
      "datasetId": "launch-contacts",
      "autopilotMode": "assisted"
    },
    "nimbusGuardian": {
      "policyId": "guardian-prod-gate",
      "environment": "production",
      "gateLevel": "enforced"
    },
    "clearSeas": {
      "engagementId": "clear-seas-beta",
      "serviceTier": "pilot",
      "liaison": "Iris Calderon"
    },
    "sharedNarrative": "Parse → Plan → Ship cadence",
    "nextSyncIso": "2025-11-03T15:00:00Z"
  }
}
```

MINOOTS will project `ecosystem.sources=3`, ensure the metadata persists in Postgres, and echo the payload through REST/gRPC responses so Parserator, Reposiologist, Nimbus Guardian, and Clear Seas teams can all subscribe to the same cadence.
