# Minoots Mobile (Phase 5 Companion)

The Expo-powered mobile companion brings the Phase 5 control center to iOS and Android with live timer telemetry, analytics sparklines, and quick actions.

## Running locally

```bash
cd apps/mobile
npm install
npm start
```

Use the Expo Go app or an emulator to open the project. The app ships with a mock data layer so it runs offline while demonstrating live timer updates and analytics trends.

## Screens

- **Timers** – responsive cards with progress, owner context, and status pills.
- **Analytics** – SVG polyline chart illustrating completions vs. failures.
- **Actions** – quick links for common operational tasks.

Future work will connect the mobile app to the real control plane, share authentication with the web dashboard, and introduce push notifications for timer events.

## Assets

To keep the repository binary-free, the project relies on Expo's default iconography and splash screens. If you need branded assets, add your PNG files to `apps/mobile/assets/` locally (the directory is git-ignored) and reference them from `app.json` before building a release.
