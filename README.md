# MINOOTS ⏱️🚀

**Independent Timer System for Autonomous Agents & Enterprise Workflows**

[![npm version](https://badge.fury.io/js/%40minoots%2Ftimer-system.svg)](https://badge.fury.io/js/%40minoots%2Ftimer-system)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/domusgpt/minoots-timer-system/workflows/Tests/badge.svg)](https://github.com/domusgpt/minoots-timer-system/actions)
[![Coverage](https://codecov.io/gh/domusgpt/minoots-timer-system/branch/main/graph/badge.svg)](https://codecov.io/gh/domusgpt/minoots-timer-system)

## 🎯 What is MINOOTS?

MINOOTS is a production-ready timer system that runs **independently** of your main application. Perfect for:

- 🤖 **AI Agents** that need persistent timers across sessions
- 🔄 **Workflow Automation** with reliable scheduling
- 🏢 **Enterprise Systems** requiring bulletproof timing
- 🚀 **Background Jobs** that survive process crashes

## 🚀 Quick Start

```bash
npm install -g @minoots/timer-system
minoots create 30s "coffee_break"
minoots list
```

```javascript
const MINOOTS = require('@minoots/timer-system');

// Create a timer that survives process crashes
const timer = MINOOTS.create({
  name: 'backup_database',
  duration: '1h',
  events: {
    on_expire: {
      webhook: 'https://api.example.com/backup-complete',
      message: 'Database backup completed'
    }
  }
});

console.log(`Timer ${timer.id} will execute in 1 hour`);
```

## ✨ Key Features

### 🛡️ Independent Execution
- Timers run in separate processes
- Survive main application crashes
- Continue running across system reboots
- No dependency on parent process lifecycle

### 🔧 Powerful Events
```javascript
{
  events: {
    on_expire: {
      webhook: 'https://api.example.com/notify',
      file_write: { file: 'result.txt', content: 'Timer done!' },
      command: 'npm run deploy',
      message: 'Deployment timer expired'
    }
  }
}
```

### 📡 Real-time Monitoring
```javascript
// Get live timer status
const status = MINOOTS.get('timer_id');
console.log(`${status.progress * 100}% complete`);
console.log(`${status.timeRemaining}ms remaining`);
```

### 🌐 Cloud Integration
- Firebase backend for global synchronization
- REST API for cross-platform access
- Team collaboration and sharing
- Enterprise authentication (SSO)

## 🧱 System architecture & services

MINOOTS follows the distributed horology blueprint outlined in `AGENTIC_TIMER_ARCHITECTURE.md`. The repository ships the following runnable services today:

| Component | Path | What ships now |
| --- | --- | --- |
| Control Plane service | `apps/control-plane` | Express + Zod API for creating, listing, and cancelling timers with multi-tenant validation |
| Horology Kernel | `services/horology-kernel` | Rust scheduler with Tokio-driven timers, broadcast event stream, and cancellation semantics |
| Action Orchestrator | `services/action-orchestrator` | Timer event consumers that trigger webhooks and stubbed agent prompts |
| Contracts & Dev Track | `proto/timer.proto`, `docs/DEVELOPMENT_TRACK.md` | gRPC definitions and the execution plan for landing the full platform |

## ✅ What works today

- **Timer lifecycle** – REST and gRPC flows create, fetch, list, and cancel timers while persisting state to Postgres for durability.
- **Resilient scheduling** – The Rust kernel keeps time independently, exposes an event stream, and gracefully handles reconnects from the control plane.
- **Action delivery** – The Node-based orchestrator consumes kernel events and triggers HTTP webhooks, CLI commands, or file writes defined on each timer.
- **Agent tooling** – `integrations/python/minoots_agent_tools` includes a Python client plus LangChain and LlamaIndex helpers so agents can schedule timers programmatically.
- **Automation hooks** – `github-actions/schedule-timer` enables CI pipelines to create timers, and the `/ato` Slack command (under `apps/slack-bot`) provides a lightweight human interface.
- **Configuration contract** – Shared environment variables across services keep kernel locations, gateway mode, and tenant scopes in sync.

## 🔭 Opportunities & next steps

The core platform runs end-to-end, but several areas are ready for expansion:

- **High availability** – Add leader election and hot standby support for the horology kernel to remove the current single-instance limitation.
- **Policy enforcement** – Extend `apps/control-plane` policies beyond tenant validation to cover quota management, per-tenant rate limits, and feature gating.
- **Action orchestration** – Graduate the orchestrator from stubbed prompts to production-grade connectors (Slack, PagerDuty, cloud functions) with retries and observability.
- **Observability** – Ship consolidated metrics, tracing, and alerting around timer creation latency, drift, and execution failures.
- **Ecosystem payloads** – The existing `metadata.ecosystem` structure remains optional; future work should generalise the schema so any partner integration can attach domain-specific context without bespoke code.

## 🤝 Integrations & extensions

- **LangChain / LlamaIndex** – `integrations/python/minoots_agent_tools` packages reusable helpers (`AtoTimerTool`, `create_minoots_tool`) to embed timers in agent workflows.
- **GitHub Action** – `github-actions/schedule-timer` lets CI pipelines create timers with regional hints and metadata.
- **Slack bot** – `apps/slack-bot` offers a `/ato` slash command powered by the control plane for fast collaboration.
- **Marketing playbooks** – The Phase 4 assets under `docs/marketing/` remain available for teams coordinating community and launch efforts.

## 🧑‍💻 Local development stack
1. Install dependencies:
   - `cd apps/control-plane && npm install`
   - `cd services/action-orchestrator && npm install`
   - `cd services/horology-kernel && cargo build`
2. Run the services:
   - Control plane REST API: `npm run dev` (port 4000)
   - Horology kernel gRPC server: `cargo run --bin kernel` (set `KERNEL_GRPC_ADDR` to override the default `0.0.0.0:50051`)
   - Action orchestrator: `npm run dev` (set `KERNEL_GRPC_URL` or fall back to `NATS_URL` / STDIN streaming)
3. Export the shared configuration so every service resolves the same kernel endpoint:
   ```bash
   export KERNEL_GRPC_URL=localhost:50051
   export KERNEL_GATEWAY_MODE=grpc           # control plane falls back to memory if the kernel is unavailable
   export KERNEL_EVENT_TENANT_ID=__all__     # orchestrator can scope streams per tenant
   ```
4. Use the existing CLI (`independent-timer.js`) or HTTP calls to interact with the control plane and watch timers propagate
   through the kernel and orchestrator.

See [`docs/DEVELOPMENT_TRACK.md`](docs/DEVELOPMENT_TRACK.md) for the detailed engineering track and next milestones. Deployment and troubleshooting guidance lives in [`docs/devx/DEPLOYMENT_AND_TROUBLESHOOTING.md`](docs/devx/DEPLOYMENT_AND_TROUBLESHOOTING.md).

### Service configuration contract

| Variable | Default | Consumer(s) | Purpose |
| --- | --- | --- | --- |
| `KERNEL_GRPC_ADDR` | `0.0.0.0:50051` | Horology kernel | Binds the scheduler's gRPC listener (also read as `KERNEL_GRPC_URL` for backwards compatibility). |
| `KERNEL_GRPC_URL` | `localhost:50051` | Control plane, Action orchestrator | Location of the kernel when acting as a client. |
| `KERNEL_GATEWAY_MODE` | `grpc` | Control plane | Switches between the real kernel and the in-memory fallback (`memory`). |
| `KERNEL_EVENT_TENANT_ID` | `__all__` | Action orchestrator | Restricts the gRPC event stream to a single tenant when desired.|

All gRPC schedule/list/get/cancel calls now pass metadata, labels, action bundles, and agent bindings as canonical JSON strings.
Clients are responsible for serializing structured payloads before sending requests and for parsing JSON when receiving timers
or stream events.

### Optional ecosystem metadata

Timers may include an `ecosystem` payload when teams need to align MINOOTS with neighbouring products (Parserator, Reposiologist, Nimbus Guardian, or Clear Seas engagements). The control plane persists the payload under `metadata.ecosystem` and projects curated labels for dashboards and search. The canonical field reference lives in [`docs/integrations/ECOSYSTEM_METADATA.md`](docs/integrations/ECOSYSTEM_METADATA.md). The schema is intentionally permissive—supplying a shared narrative or sync timestamp is enough when fuller integrations are not required.
## 📖 Documentation

### Basic Usage

#### Create Timers
```javascript
// Simple timer
MINOOTS.create({ name: 'simple', duration: '30s' });

// Complex workflow timer
MINOOTS.create({
  name: 'deployment_pipeline',
  duration: '15m',
  metadata: { environment: 'production', version: '1.2.3' },
  events: {
    on_expire: {
      webhook: 'https://api.company.com/deploy-complete',
      command: 'docker deploy production:latest',
      file_write: {
        file: 'deployment.log',
        content: 'Production deployment completed at ${timestamp}'
      }
    }
  }
});
```

#### Duration Formats
```javascript
'30s'    // 30 seconds
'5m'     // 5 minutes  
'2h'     // 2 hours
'1d'     // 1 day
3600000  // milliseconds
```

#### Monitor Timers
```javascript
// List all active timers
const timers = MINOOTS.list();
timers.forEach(t => {
  console.log(`${t.name}: ${Math.round(t.progress * 100)}% complete`);
});

// Get specific timer
const timer = MINOOTS.get('timer_id');
console.log(`Status: ${timer.status}`);
console.log(`Remaining: ${timer.timeRemaining}ms`);

// Read timer logs
const logs = MINOOTS.logs('timer_id');
console.log(logs);
```

#### Cancel & Cleanup
```javascript
// Cancel specific timer
MINOOTS.cancel('timer_id');

// Clean up completed timers
MINOOTS.cleanup();
```

### Advanced Features

#### Timer Chains
```javascript
// Create dependent timers
const timer1 = MINOOTS.create({ name: 'step1', duration: '1m' });
const timer2 = MINOOTS.create({ 
  name: 'step2', 
  duration: '30s',
  depends_on: timer1.id 
});
```

#### Conditional Execution
```javascript
MINOOTS.create({
  name: 'conditional_deploy',
  duration: '5m',
  conditions: {
    environment: 'production',
    tests_passed: true
  }
});
```

#### Team Collaboration
```javascript
// Share timer with team
MINOOTS.share('timer_id', {
  team: 'devops-team',
  permissions: ['read', 'cancel']
});
```

## 🛠️ Installation & Setup

### Local Development
```bash
git clone https://github.com/domusgpt/minoots-timer-system.git
cd minoots-timer-system
npm install
npm test
npm start
```

### Cloud Setup (Firebase)
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Deploy MINOOTS backend
firebase login
firebase deploy

# Configure authentication
firebase auth:import users.json
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t minoots .
docker run -d -p 3000:3000 minoots
```

## 🔌 Integrations

### MCP (Model Context Protocol)
```javascript
// For AI agents using Claude Code
const mcp = require('@minoots/mcp-extension');

// Create timer through MCP
await mcp.createTimer({
  name: 'agent_task_timeout',
  duration: '10m',
  agent_id: 'claude_agent_001'
});
```

### REST API
```bash
# Create timer via API
curl -X POST https://api.minoots.com/v1/timers \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "api_timer",
    "duration": "5m",
    "events": {
      "on_expire": {
        "webhook": "https://myapp.com/timer-done"
      }
    }
  }'

# Get timer status
curl https://api.minoots.com/v1/timers/timer_id \
  -H "Authorization: Bearer $API_KEY"
```

### Webhooks
```javascript
// Receive timer events
app.post('/webhook/timer-expired', (req, res) => {
  const { timer, event, timestamp } = req.body;
  console.log(`Timer ${timer.name} expired at ${timestamp}`);
  res.status(200).send('OK');
});
```

## 💰 Pricing

### Free Tier
- ✅ Up to 100 active timers
- ✅ Basic webhook support
- ✅ Community support
- ✅ 30-day history

### Pro ($9/month)
- ✅ Up to 10,000 timers
- ✅ Advanced webhooks
- ✅ Team collaboration
- ✅ Priority support
- ✅ 1-year history

### Enterprise ($99/month)
- ✅ Unlimited timers
- ✅ SSO integration
- ✅ Custom integrations
- ✅ SLA guarantees
- ✅ Dedicated support

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development setup
npm install
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📚 [Documentation](https://docs.minoots.com)
- 💬 [Discord Community](https://discord.gg/minoots)
- 🐛 [Report Issues](https://github.com/domusgpt/minoots-timer-system/issues)
- 📧 [Email Support](mailto:support@minoots.com)

---

**Built with ❤️ for autonomous agents and enterprise workflows**

*MINOOTS: Because your timers should be as reliable as your code.*