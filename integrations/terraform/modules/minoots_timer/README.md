# MINOOTS Timer Terraform Module

This lightweight module provisions a timer through the MINOOTS API as part of your infrastructure pipeline. It shells out to a Node.js script so that teams can use native Terraform workflows while the official provider is under development.

## Usage

```hcl
module "deployment_timer" {
  source   = "./integrations/terraform/modules/minoots_timer"
  api_key  = var.minoots_api_key
  team     = var.team_id
  name     = "deploy"
  duration = "15m"
  metadata = {
    pipeline = "${var.pipeline_id}"
  }
}
```

Set the `MINOOTS_API_BASE` variable when targeting staging environments.
