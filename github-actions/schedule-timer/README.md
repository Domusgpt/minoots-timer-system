# Schedule MINOOTS timer GitHub Action

Use this composite action to create timers directly from GitHub workflows. The
step invokes the MINOOTS control plane REST API, so any timer scheduled here is
immediately available to agents, dashboards, and the new multi-region kernel.

```yaml
- name: Schedule follow-up timer
  uses: ./github-actions/schedule-timer
  with:
    api-key: ${{ secrets.MINOOTS_API_KEY }}
    tenant-id: team-alpha
    duration: 20m
    name: build-follow-up
    metadata: '{"trigger":"ci","repository":"${{ github.repository }}"}'
```

Provide either `duration` (e.g. `15m` or `60000`) or `fire-at` (ISO timestamp).
Optional inputs let you attach metadata, labels, action bundles, or target a
specific region in the multi-region deployment.

Outputs expose the timer identifier, resolved fire-at timestamp, and region so
subsequent workflow steps can log or store the details.
