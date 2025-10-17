# MINOOTS Timer GitHub Action

Composite action that schedules a MINOOTS timer and waits for it to settle inside your workflow.

## Usage

```yaml
- name: Wait for build window
  uses: ./.github/actions/minoots-timer
  with:
    api-key: ${{ secrets.MINOOTS_API_KEY }}
    duration: 2m
    name: ci-build-window
    agent-id: github_ci
    team: platform
```

Outputs:

- `timer-id` – Created timer identifier
- `status` – Final timer status (`expired`, `completed`, etc.)
- `payload` – JSON payload returned by the final poll

Optional inputs:

- `metadata` – JSON string attached to the timer
- `poll-interval` – Seconds between status checks (default 5)
- `base-url` – Override API URL for staging/self-hosted deployments

The action relies on Node 20's built-in `fetch` and does not require bundling dependencies.
