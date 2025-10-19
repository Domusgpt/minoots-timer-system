# MINOOTS Desktop Shell

Early Electron wrapper for the MINOOTS dashboard. Loads the hosted dashboard URL inside a frameless desktop window with a tray icon for quick access.

## Usage

```bash
cd apps/desktop
npm install
npm start
```

The window targets `https://dashboard.minoots.dev` by default. Set `MINOOTS_DASHBOARD_URL` to point at a local dev server.

Place a custom tray icon at `apps/desktop/icons/tray.png` (32x32 PNG recommended). If omitted, Electron will fall back to an empty tray icon.

## Roadmap

- Integrate native notifications for timer completions.
- Sync authentication tokens between the dashboard and desktop shell.
- Add offline caching for analytics snapshots.
