# Minoots Mobile (Phase 5 Companion)

The Expo-powered mobile companion brings the Phase 5 control center to iOS and Android with live timer telemetry, analytics sparklines, and quick actions.

## Running locally

```bash
cd apps/mobile
npm install
npm start
```

Use the Expo Go app or an emulator to open the project. The app ships with a mock data layer so it runs offline while demonstrating live timer updates and analytics trends.

> **Heads up about icons:** Binary assets are intentionally omitted from version control. When you brand the mobile companion, add your own `icon`, `splash`, and adaptive icon images under `apps/mobile/assets/` and update `app.json` accordingly. Expo falls back to its default iconography when those files are absent so local development still works out of the box.

## Screens

- **Timers** – responsive cards with progress, owner context, and status pills.
- **Analytics** – SVG polyline chart illustrating completions vs. failures.
- **Actions** – quick links for common operational tasks.

Future work will connect the mobile app to the real control plane, share authentication with the web dashboard, and introduce push notifications for timer events.
