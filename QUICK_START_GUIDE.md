# 🚀 MINOOTS Timer System - Quick Start Guide

**Get up and running in 5 minutes!**

## 🎯 What is MINOOTS?

MINOOTS is a **high-performance timer system** designed for AI agents, autonomous systems, and workflows that need reliable scheduling:

- ⚡ **Ultra-fast**: Create timers in < 1ms
- 🔄 **Scalable**: Handle 100k+ concurrent timers
- 🎯 **Reliable**: Rust-powered core with type safety
- 🌐 **Webhook-ready**: Execute actions when timers fire
- 🤖 **AI-friendly**: Perfect for autonomous agents

---

## 🏃‍♂️ 5-Minute Setup

### Step 1: Clone & Start
```bash
git clone https://github.com/Domusgpt/minoots-timer-system.git
cd minoots-timer-system
docker-compose up -d
```

### Step 2: Test the System
```bash
# Check if it's running
curl http://localhost:3000/healthz
# Expected: {"status":"ok","service":"minoots-control-plane"}
```

### Step 3: Create Your First Timer
```bash
curl -X POST http://localhost:3000/timers \
  -H "X-API-Key: mnt_demo_key_free" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "quickstart",
    "requestedBy": "new-user",
    "name": "my-first-timer",
    "duration": "10s"
  }'
```

### Step 4: Watch It Work
```bash
# List your timers
curl -H "X-API-Key: mnt_demo_key_free" \
     "http://localhost:3000/timers?tenantId=quickstart"

# Watch logs to see timer fire
docker-compose logs -f action-orchestrator
```

**🎉 Congratulations! Your timer system is running.**

---

## 🔑 Authentication

All API calls need an API key in the `X-API-Key` header:

### Demo Keys (Ready to Use)
- `mnt_demo_key_free` - 100 requests/minute, basic features
- `mnt_demo_key_pro` - 1000 requests/minute, advanced features
- `mnt_demo_key_team` - 5000 requests/minute, team features

### Example Usage
```bash
curl -H "X-API-Key: mnt_demo_key_free" \
     http://localhost:3000/timers?tenantId=demo
```

---

## 📡 API Reference

### Base URL
```
http://localhost:3000
```

### Core Endpoints

#### 🟢 GET /healthz
Check system status
```bash
curl http://localhost:3000/healthz
```

#### 🟢 POST /timers
Create a new timer
```bash
curl -X POST http://localhost:3000/timers \
  -H "X-API-Key: mnt_demo_key_free" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "your-app",
    "requestedBy": "user-123",
    "name": "reminder-timer",
    "duration": "30m",
    "metadata": {"userId": "123", "type": "reminder"},
    "actionBundle": {
      "actions": [{
        "type": "webhook",
        "url": "https://your-app.com/webhook",
        "data": {"message": "Timer completed!"}
      }]
    }
  }'
```

#### 🟢 GET /timers
List timers for a tenant
```bash
curl -H "X-API-Key: mnt_demo_key_free" \
     "http://localhost:3000/timers?tenantId=your-app"
```

#### 🟢 GET /timers/:id
Get specific timer
```bash
curl -H "X-API-Key: mnt_demo_key_free" \
     "http://localhost:3000/timers/timer-uuid-here?tenantId=your-app"
```

#### 🟡 POST /timers/:id/cancel
Cancel a timer
```bash
curl -X POST http://localhost:3000/timers/timer-uuid-here/cancel \
  -H "X-API-Key: mnt_demo_key_free" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "your-app",
    "reason": "User cancelled",
    "requestedBy": "user-123"
  }'
```

---

## ⏰ Timer Duration Formats

MINOOTS accepts flexible duration formats:

```bash
"5s"     # 5 seconds
"30m"    # 30 minutes
"2h"     # 2 hours
"1d"     # 1 day
"5000"   # 5000 milliseconds (number)
```

---

## 🎣 Webhooks & Actions

When timers fire, MINOOTS can execute actions:

### Webhook Action
```json
{
  "actionBundle": {
    "actions": [{
      "type": "webhook",
      "url": "https://your-app.com/timer-fired",
      "data": {
        "message": "Timer completed!",
        "customField": "value"
      }
    }]
  }
}
```

### Webhook Payload
Your webhook will receive:
```json
{
  "event": "timer.fired",
  "timer_id": "uuid-here",
  "tenant_id": "your-app",
  "timer_name": "my-timer",
  "fired_at": "2024-01-15T10:30:00Z",
  "data": {
    "message": "Timer completed!",
    "customField": "value"
  }
}
```

### Command Action (Advanced)
```json
{
  "actionBundle": {
    "actions": [{
      "type": "command",
      "command": "echo 'Timer $TIMER_NAME completed'",
      "data": {}
    }]
  }
}
```

---

## 🚀 Use Cases

### 1. AI Agent Timeouts
```python
# Python example
import requests

def set_agent_timeout(agent_id: str, timeout_minutes: int):
    response = requests.post("http://localhost:3000/timers",
        headers={"X-API-Key": "mnt_demo_key_pro"},
        json={
            "tenantId": f"agent-{agent_id}",
            "requestedBy": "ai-controller",
            "name": f"timeout-{agent_id}",
            "duration": f"{timeout_minutes}m",
            "actionBundle": {
                "actions": [{
                    "type": "webhook",
                    "url": "https://ai-system.com/agent/timeout",
                    "data": {"agent_id": agent_id, "action": "force_stop"}
                }]
            }
        }
    )
    return response.json()
```

### 2. Workflow Delays
```javascript
// JavaScript example
async function delayWorkflow(workflowId, delaySeconds) {
  const response = await fetch('http://localhost:3000/timers', {
    method: 'POST',
    headers: {
      'X-API-Key': 'mnt_demo_key_free',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tenantId: 'workflow-engine',
      requestedBy: 'workflow-scheduler',
      name: `delay-${workflowId}`,
      duration: `${delaySeconds}s`,
      actionBundle: {
        actions: [{
          type: 'webhook',
          url: 'https://workflow.com/continue',
          data: { workflow_id: workflowId }
        }]
      }
    })
  });

  return response.json();
}
```

### 3. Reminder System
```bash
# Create a reminder
curl -X POST http://localhost:3000/timers \
  -H "X-API-Key: mnt_demo_key_free" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "reminder-app",
    "requestedBy": "user-456",
    "name": "meeting-reminder",
    "duration": "15m",
    "metadata": {"meeting_id": "meet-123", "user_id": "user-456"},
    "actionBundle": {
      "actions": [{
        "type": "webhook",
        "url": "https://reminder-app.com/notify",
        "data": {
          "type": "meeting_reminder",
          "message": "Meeting starts in 15 minutes!",
          "meeting_id": "meet-123"
        }
      }]
    }
  }'
```

---

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  CONTROL PLANE  │    │ HOROLOGY KERNEL │    │ACTION ORCHESTR. │
│   (TypeScript)  │    │     (Rust)      │    │     (Rust)      │
│                 │    │                 │    │                 │
│ • REST API      │◄──►│ • Timer Core    │───►│ • Webhooks      │
│ • Auth & Limits │    │ • Event Stream  │    │ • Commands      │
│ • Validation    │    │ • Memory Store  │    │ • Retries       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
   Your Application         Timer Events          External APIs
```

**Flow:**
1. Your app creates timer via REST API
2. Kernel schedules timer in memory
3. When timer fires, kernel emits event
4. Orchestrator executes webhook/command
5. Your app receives notification

---

## 🔍 Monitoring & Debugging

### Check System Status
```bash
# Overall health
curl http://localhost:3000/healthz

# Service status
docker-compose ps

# View logs
docker-compose logs -f
```

### Debug Timer Issues
```bash
# List all timers for debugging
curl -H "X-API-Key: mnt_demo_key_pro" \
     "http://localhost:3000/timers?tenantId=debug"

# Watch action orchestrator logs
docker-compose logs -f action-orchestrator

# Watch kernel logs
docker-compose logs -f horology-kernel
```

### Common Issues

**Timer not firing?**
- Check action-orchestrator logs for errors
- Verify webhook URL is accessible
- Ensure timer duration is reasonable (> 1s)

**API returning 401?**
- Check X-API-Key header is present
- Verify key starts with `mnt_`
- Try demo keys: `mnt_demo_key_free`

**Rate limited?**
- Free tier: 100 requests/minute
- Pro tier: 1000 requests/minute
- Wait or upgrade key tier

---

## 📊 Performance & Limits

### Performance Metrics
- **Timer Creation**: < 1ms
- **Webhook Execution**: < 100ms (network dependent)
- **Memory per Timer**: ~1KB
- **Max Concurrent Timers**: 100,000+

### Rate Limits by Tier
| Tier | Requests/Min | Features |
|------|-------------|----------|
| Free | 100 | Basic timers, webhooks |
| Pro  | 1,000 | Everything + priority |
| Team | 5,000 | Everything + team features |

### Duration Limits
- **Minimum**: 1 second
- **Maximum**: 30 days
- **Precision**: Millisecond accuracy

---

## 🛠️ Development Setup

Want to contribute or run locally?

### Prerequisites
- Docker & Docker Compose
- Rust 1.75+ (for development)
- Node.js 18+ (for development)

### Local Development
```bash
# Clone repo
git clone https://github.com/Domusgpt/minoots-timer-system.git
cd minoots-timer-system

# Start kernel (Terminal 1)
cd services/horology-kernel
cargo run

# Start control plane (Terminal 2)
cd apps/control-plane
npm install && npm run dev

# Start action orchestrator (Terminal 3)
cd services/action-orchestrator
DEMO_MODE=1 cargo run
```

### Run Tests
```bash
# Test Rust kernel
cd services/horology-kernel
cargo test

# Test control plane
cd apps/control-plane
npm test
```

---

## 🆘 Support & Community

### Documentation
- **API Reference**: This guide
- **Architecture**: See `DEPLOYMENT_COMPLETE.md`
- **Source Code**: [GitHub](https://github.com/Domusgpt/minoots-timer-system)

### Getting Help
- **Issues**: [GitHub Issues](https://github.com/Domusgpt/minoots-timer-system/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Domusgpt/minoots-timer-system/discussions)
- **Examples**: Check `examples/` directory

### Contributing
Pull requests welcome! See `CONTRIBUTING.md` for guidelines.

---

## 🚀 Next Steps

1. **Try the examples** above with your own webhooks
2. **Build your first integration** with your app
3. **Scale up** from demo keys to production keys
4. **Monitor performance** as you add load
5. **Join the community** and share your use case!

**Happy timing! ⏰**