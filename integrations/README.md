# MINOOTS Developer Tool Integrations

These adapters wire the MINOOTS timer platform into the automation tools developers already rely on. Each integration uses the new `minoots` CLI (bundled with the Node SDK) so CI pipelines, infrastructure deployments, and editors can orchestrate timers without re-implementing REST calls.

## Available adapters

| Tool | Location | Highlights |
| --- | --- | --- |
| GitHub Actions | `integrations/github/workflows/minoots-ci.yml` | Create timers before long-running jobs, wait for completion, and publish analytics to job summaries. |
| GitLab CI | `integrations/gitlab/.gitlab-ci.yml` | Pipeline stage helpers for provisioning timers and streaming status back to the job log. |
| Jenkins | `integrations/jenkins/Jenkinsfile` | Declarative pipeline shared library example invoking the CLI with credential bindings. |
| Terraform | `integrations/terraform/modules/minoots_timer` | Module that provisions timers and webhooks as infrastructure, supporting plan/apply flows. |

## Prerequisites

1. Install the Node SDK (or use `npx minoots-sdk@latest`).
2. Export a `MINOOTS_API_KEY` with sufficient privileges for the target team.
3. Optionally set `MINOOTS_API_BASE` if orchestrating against a non-production API host.

## Local smoke test

```bash
npm --prefix sdk install
npm --prefix sdk run cli
```

The CLI help output documents the available commands for webhooks and integrations management. Automation adapters call the same entry points.
