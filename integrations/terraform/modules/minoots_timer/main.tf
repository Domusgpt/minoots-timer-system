terraform {
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = ">= 3.4.0"
    }
  }
}

locals {
  payload = jsonencode({
    team     = var.team
    name     = var.name
    duration = var.duration
    metadata = var.metadata
  })

  api_base = var.api_base != "" ? var.api_base : "https://api-m3waemr5lq-uc.a.run.app"
}

resource "null_resource" "minoots_timer" {
  provisioner "local-exec" {
    command = <<EOT
set -euo pipefail
export MINOOTS_API_KEY="${var.api_key}"
export MINOOTS_API_BASE="${local.api_base}"
node - <<'SCRIPT'
const https = require('https');
const { URL } = require('url');
const payload = JSON.parse('${local.payload}');
const base = process.env.MINOOTS_API_BASE;
const target = new URL('/timers', base);
const req = https.request(target, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.MINOOTS_API_KEY}`,
  },
});
req.on('response', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode && res.statusCode >= 400) {
      console.error('Failed to create timer:', data);
      process.exit(1);
    }
    const fs = require('fs');
    fs.writeFileSync('minoots_timer.json', data);
    console.log(data);
  });
});
req.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
req.write(JSON.stringify(payload));
req.end();
SCRIPT
EOT
    interpreter = ["/bin/bash", "-c"]
  }
}
