# MINOOTS - The Metronome for Autonomous AI ⏱️🤖

**Independent Timer System for AI Agents & Enterprise Workflows**

🌐 **Live Website:** https://domusgpt.github.io/Minoots-Beta
🚀 **Production API:** https://api-m3waemr5lq-uc.a.run.app
📦 **Main Repository:** https://github.com/Domusgpt/minoots-timer-system

---

## 🎯 What is MINOOTS?

MINOOTS is a production-ready durable execution platform that lets AI agents create workflows that sleep, wake, and execute tasks automatically over extended periods (minutes, hours, days, or weeks). Unlike traditional automation that requires constant monitoring, MINOOTS workflows hibernate during wait periods, consuming **zero resources**, then automatically wake up to continue execution.

### Key Features

- 🤖 **AI Agent Native** - First timer system designed specifically for AI agents with MCP integration
- 💤 **Zero-Resource Sleep** - 0% CPU, 0 memory, 0 API tokens during hibernation
- 🛡️ **Crash Recovery** - Survives system crashes and restarts with full state persistence
- ⚡ **Precise Timing** - ±1 second accuracy for timers spanning seconds to weeks
- 🔗 **Multi-Agent Coordination** - Orchestrate complex workflows across specialized agents
- 🏢 **Enterprise Ready** - Authentication, billing, rate limiting, and SLA guarantees

---

## 🚀 Quick Start

### Create Your First Timer

```javascript
const MINOOTS = require('@minoots/timer-system');

// Create a timer that survives process crashes
const timer = MINOOTS.create({
  name: 'backup_database',
  duration: '1h',
  events: {
    on_expire: {
      webhook: 'https://api.example.com/backup-complete'
    }
  }
});
```

### For AI Agents (Claude Desktop)

```
User: "Create a workflow that checks my website every hour and alerts me if it's down"

Claude: I'll create a monitoring workflow for you.
[Uses MINOOTS MCP tools]
✅ Created workflow "website_monitor" - checking every hour
```

---

## 💡 Use Cases

### 🤖 Autonomous AI Workflows
AI agents schedule themselves to wake up and continue work hours or days later.

```javascript
workflow.steps = [
  { action: 'start_data_processing' },
  { sleep: '4h' },  // Agent hibernates
  { action: 'check_results_and_continue' }
];
```

### 🚀 CI/CD Pipeline Automation
Automated deployment with health checks and rollback conditions.

```javascript
workflow.steps = [
  { action: 'trigger_build' },
  { sleep: '5m' },
  { action: 'deploy_if_successful' },
  { sleep: '10m' },
  { action: 'rollback_if_unhealthy' }
];
```

### 📧 Lead Nurturing Campaigns
Automated marketing with intelligent timing and context.

```javascript
workflow.steps = [
  { action: 'send_welcome_email' },
  { sleep: '24h' },
  { action: 'send_product_demo' },
  { sleep: '3d' },
  { action: 'schedule_sales_call' }
];
```

---

## 📊 Production Stats

| Metric | Value |
|--------|-------|
| **Timer Precision** | ±1 second |
| **CPU During Sleep** | 0% |
| **Uptime SLA** | 99.9% |
| **Concurrent Timers** | 100,000+ |
| **API Response Time** | <100ms p95 |

---

## 🔧 Installation

### NPM Package (Coming Soon)
```bash
npm install @minoots/timer-system
```

### From Source
```bash
git clone https://github.com/Domusgpt/minoots-timer-system.git
cd minoots-timer-system
npm install
```

### MCP Integration (Claude Desktop)
```json
{
  "mcpServers": {
    "minoots": {
      "command": "node",
      "args": ["path/to/minoots-v2-server.js"]
    }
  }
}
```

---

## 📖 Documentation

- **Main Repo:** [minoots-timer-system](https://github.com/Domusgpt/minoots-timer-system)
- **API Docs:** [api-m3waemr5lq-uc.a.run.app](https://api-m3waemr5lq-uc.a.run.app)
- **Comprehensive Analysis:** [MINOOTS_COMPREHENSIVE_ANALYSIS.md](https://github.com/Domusgpt/Minoots-Beta/blob/main/planning/MINOOTS_COMPREHENSIVE_ANALYSIS.md)

---

## 💰 Pricing

| Tier | Price | Timers | Features |
|------|-------|--------|----------|
| **Free** | $0/mo | 5 concurrent, 100/month | Core features, community support |
| **Pro** | $19/mo | Unlimited | + MCP integration, webhooks, priority support |
| **Team** | $49/mo | Unlimited | + Team collaboration, advanced analytics |
| **Enterprise** | Custom | Unlimited | + SSO, SLA, on-premises, dedicated support |

---

## 🎨 This Website

This is the marketing and documentation website for MINOOTS, built with the **Visual Codex** design system:

- **Holographic Parallax** - Multi-layer depth effects with blend modes
- **Neoskeuomorphic Cards** - Advanced shadow systems with tactile depth
- **Interactive Timer Visualization** - Live pulsing rings representing precision timing
- **Mouse Parallax** - Background responds to cursor movement
- **Scroll Reveal Animations** - Elements fade in as you scroll
- **Mobile-First Design** - Touch-optimized with adaptive performance

### Design System
- **Primary Color:** Deep Space Blue (#0a0e27)
- **Accent Colors:** Electric Cyan (#00ffff), Violet Purple (#9d4edd), Soft Teal (#06ffa5)
- **Typography:** Modern sans-serif with monospace for code
- **Effects:** Screen/overlay/color-dodge blend modes, CSS animations, WebGL-inspired visuals

---

## 🤝 Contributing

We welcome contributions to MINOOTS! See the [main repository](https://github.com/Domusgpt/minoots-timer-system) for contribution guidelines.

---

## 📞 Contact & Support

- 📚 [Documentation](https://github.com/Domusgpt/minoots-timer-system#readme)
- 🐛 [Report Issues](https://github.com/Domusgpt/minoots-timer-system/issues)
- 💬 [GitHub Discussions](https://github.com/Domusgpt/minoots-timer-system/discussions)

---

## 📄 License

MIT License - see [LICENSE](https://github.com/Domusgpt/minoots-timer-system/blob/main/LICENSE) file for details.

---

# 🌟 A Paul Phillips Manifestation

**Send Love, Hate, or Opportunity to:** Paul@clearseassolutions.com
**Join The Exoditical Moral Architecture Movement:** [Parserator.com](https://parserator.com)

> *"The Revolution Will Not be in a Structured Format"*

---

**© 2025 Paul Phillips - Clear Seas Solutions LLC**
**All Rights Reserved - Proprietary Technology**

---

**Built with ❤️ for autonomous agents and enterprise workflows**

*MINOOTS: Because your timers should be as reliable as your code.*
