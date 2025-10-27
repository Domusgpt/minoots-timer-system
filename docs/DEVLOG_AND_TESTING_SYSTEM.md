# Devlog & Testing System for the Async Refactor

This document operationalizes the developer logging, testing cadence, and automation policies referenced in the Ultimate Async Refactor Program. It defines where logs live, how teams record progress, and which test suites guard every change.

## 1. Devlog Structure
- **Location:** `docs/devlog/` directory with one markdown file per day (`YYYY-MM-DD.md`).
- **Ownership:** Each stream (CP, HK, EM, DX, Governance) contributes a section per day. Rotate authorship weekly to ensure coverage.
- **Template:**
  ```markdown
  # YYYY-MM-DD Devlog

  ## Highlights
  - Major accomplishments, incidents, or decisions.

  ## Stream Updates
  ### Control Plane (CP)
  - Yesterday: ...
  - Today: ...
  - Risks / Blockers: ...
  - Telemetry Links: [trace id](...), [dashboard](...)

  ### Horology Kernel (HK)
  ...

  ## Testing Summary
  - ✅ command `npm test`
  - ✅ command `cargo test`
  - ⚠️ command `npm run test:e2e` (blocked: awaiting JetStream container)

  ## Decisions & Follow-ups
  - Decision log entries with owner + due date.
  ```
- **Automation:** Add a CI check to ensure a devlog file exists for each weekday with at least one stream update referencing active story IDs.
- **Archival:** At the end of each week, roll daily files into `docs/devlog/weekly/` summaries and link them from `IMPLEMENTATION_LOG.md`.

## 2. Testing Cadence
| Layer | Responsible Stream | Command | Trigger |
| --- | --- | --- | --- |
| Unit Tests | Owning service team | `npm test` / `cargo test` | Pre-commit & CI |
| Contract Tests | Shared | `npm run test:contracts` | When proto/schemas change |
| Integration | DX + CP/HK/EM | `npm run test:e2e` (spins services) | Nightly + PRs touching multiple planes |
| Chaos | HK + EM | `npm run chaos:kernel`, `npm run chaos:jetstream` | Weekly drill |
| Load/Perf | Platform | `npm run test:load` | Before release & major infra changes |

All commands must emit OTEL traces and structured logs stored with trace IDs referenced in the devlog.

## 3. Tooling & Automation
- **Dev Containers:** Provide `.devcontainer` config with Postgres, JetStream, OTEL collector running via `docker-compose.dev.yml`.
- **Pre-Commit Hooks:**
  - Lint & format: `eslint`, `cargo fmt`, `cargo clippy`.
  - Test smoke: `npm test -- --watch=false`, `cargo test --lib`.
  - Devlog check: verify that `docs/devlog/YYYY-MM-DD.md` exists and contains `## Testing Summary` section.
- **CI Gates:**
  - Fails if required tests missing, devlog absent, or OTEL trace IDs not linked in PR description.
  - Publishes coverage + jitter metrics to dashboard; attaches JetStream lag stats to PR comment.

## 4. Documentation & Traceability
- Update `IMPLEMENTATION_LOG.md` weekly with links to devlog summaries, major decisions, and metric snapshots.
- When a feature flag or migration is added, record it in the devlog and create a corresponding runbook entry in `docs/runbooks/`.
- Maintain a `docs/decisions/ADR-XXXX.md` folder for architecture decisions referenced from devlog entries.

## 5. Immediate Actions
1. Create `docs/devlog/` directory with a Day 0 entry (see kickoff checklist in the refactor charter).
2. Add devlog + testing checks to CI (GitHub Actions) and pre-commit pipeline.
3. Publish quickstart doc showing how to run Postgres + JetStream + OTEL collector locally and capture trace IDs.
4. Align each stream lead on devlog rotation and testing responsibilities.

This system ensures progress on the async refactor is observable, reproducible, and test-first across every service.
