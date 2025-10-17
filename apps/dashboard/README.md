# Minoots Control Center (Phase 5 UI)

The Phase 5 autonomous control center delivers the real-time dashboard, analytics, team management, billing, and integration surfaces for the Minoots platform.

## Getting started

```bash
npm install
npm run dev
```

Environment variables are read from `.env` or the shell:

- `VITE_MINOOTS_API_BASE` – optional base URL for the Functions/Control Plane API.
- `VITE_MINOOTS_ENVIRONMENT` – label shown in the header (defaults to `Sandbox`).

Without an API base URL the dashboard runs against an offline-first mock adapter that simulates timers, analytics, teams, billing, and streaming events.

## Features

- **Live Timer Operations** – SSE-backed status panel with stream connectivity indicators, metrics, and recent events.
- **Timer Creation Wizard** – multi-step form for duration, dependencies, scheduling, and tagging.
- **Analytics** – outcome metrics, trend visualisation, and key health indicators.
- **Team Management** – member rosters, invite lifecycle, and instant notifications.
- **Billing Suite** – Stripe-style plan summary, usage bars, and invoice ledger.
- **Integration Marketplace** – Headless UI toggles to enable/disable connectors with configuration metadata.
- **Operations Hub** – curated playbooks, runbooks, and live signal rollups for incident response.

The dashboard is styled with Tailwind CSS and includes React Query for data management. The provider auto-refreshes analytics every minute, listens to streaming timer events, and exposes imperative actions to the UI components.

## Scripts

- `npm run dev` – start the Vite dev server on port 5173.
- `npm run build` – type check and build production assets.
- `npm run preview` – preview the production build.
- `npm run lint` – lint the React codebase.

## Testing strategy

The dashboard depends on the mock Minoots client for local development, allowing UI verification without live infrastructure. When integrating with real endpoints, provide `VITE_MINOOTS_API_BASE` and ensure CORS/credentials are configured. Future E2E coverage will be added using Playwright once the hosted backend stabilises.
