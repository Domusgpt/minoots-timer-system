# 🤖 MINOOTS AGENT ONBOARDING GUIDE

**The Complete Guide for AI Agents and Autonomous Systems**

---

## 🎯 WHAT MINOOTS IS FOR AGENTS

**MINOOTS is the first timer system built specifically for AI agents and autonomous workflows.** Unlike `setTimeout()` that dies when your process crashes, MINOOTS timers run in Firebase Functions and survive any system failure.

### **Perfect For:**
- **AI Agent Coordination**: Multi-agent workflows and timing
- **Autonomous Task Scheduling**: Self-managing agent operations  
- **Workflow Orchestration**: Complex agent pipelines
- **Session Management**: Agent state persistence across restarts
- **Team Agent Collaboration**: Coordinated multi-agent systems

---

## 🚀 GETTING STARTED (ZERO TO RUNNING IN 2 MINUTES)

### **Step 1: Test the Live System**
```bash
# Verify MINOOTS is online
curl https://api-m3waemr5lq-uc.a.run.app/health
```

### **Step 2: Create Your First Timer (No Auth Required!)**
```bash
# Anonymous agents get 5 timers per day to start
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agent Test Timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/your-unique-url",
        "message": "Agent timer expired!",
        "data": {
          "agent_id": "your_agent_name",
          "next_action": "continue_workflow"
        }
      }
    }
  }'
```

### **Step 3: Bootstrap Your API Key**
```bash
# Get higher limits with your first API key
curl -X POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "My Agent API Key"}'

# SAVE THE RETURNED API KEY - IT WON'T BE SHOWN AGAIN!
```

### **Step 4: Use Your API Key**
```bash
# Now use your API key for higher limits (100 timers/day)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: mnt_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agent Workflow Timer",
    "duration": "5m",
    "metadata": {
      "agent_session": "session_123",
      "workflow_step": "data_processing",
      "priority": "high"
    }
  }'
```

---

## 📚 COMPLETE DOCUMENTATION REFERENCE

**Read these docs for complete understanding of the system:**

### **🔥 CRITICAL SYSTEM STATUS** 
- **[TODAYS_CRITICAL_FIXES.md](./TODAYS_CRITICAL_FIXES.md)** - Latest system fixes and verified working features
- **[CRITICAL_AUTHENTICATION_FIX_2025-07-14.md](./CRITICAL_AUTHENTICATION_FIX_2025-07-14.md)** - How anonymous access works
- **[API_KEY_BOOTSTRAP_ISSUE_2025-07-14.md](./API_KEY_BOOTSTRAP_ISSUE_2025-07-14.md)** - How API key creation works
- **[CRITICAL_SYSTEM_ISSUES.md](./CRITICAL_SYSTEM_ISSUES.md)** - Major issues resolved

### **📋 STRATEGIC UNDERSTANDING**
- **[MINOOTS_MASTER_PLAN.md](./MINOOTS_MASTER_PLAN.md)** - Complete 14-week roadmap and product vision
- **[STRATEGIC_IMPLEMENTATION_PLAN.md](./STRATEGIC_IMPLEMENTATION_PLAN.md)** - 5-phase implementation strategy
- **[BUSINESS_MODEL_ANALYSIS.md](./BUSINESS_MODEL_ANALYSIS.md)** - Pricing tiers and agent-focused features
- **[DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md)** - How the system is built and deployed

### **🛠️ TECHNICAL REFERENCE**
- **[README.md](./README.md)** - Main technical documentation and API reference
- **[CLAUDE.md](./CLAUDE.md)** - Complete system status and file organization

---

## 🔑 AUTHENTICATION FOR AGENTS

**MINOOTS has THREE authentication methods designed for different agent use cases:**

### **🆓 Anonymous Access (START HERE)**
- **Perfect for**: Testing, proof-of-concepts, single-agent workflows
- **Limits**: 5 timers per day per IP, 50 requests per day
- **No setup required**: Just start making API calls
- **Usage tracking**: Automatic by IP address

### **🔑 API Key Authentication (RECOMMENDED)**
- **Perfect for**: Production agents, multi-agent systems, higher usage
- **How to get**: Bootstrap from anonymous access (see Step 3 above)
- **Usage**: Add `x-api-key: mnt_your_key` header to all requests
- **Benefits**: 100 timers per day (free tier), no IP limits

### **🔐 Firebase Authentication (ADVANCED)**
- **Perfect for**: Team agent deployments, enterprise features
- **Requires**: Firebase account setup and JWT token management
- **Benefits**: Organization management, team features, analytics
- **Usage**: Add `Authorization: Bearer <jwt_token>` header

---

## 🤖 AGENT INTEGRATION PATTERNS

### **Pattern 1: Simple Agent Timer**
```python
import requests
import time

# Agent creates a timer for self-coordination
def create_agent_timer(api_key, duration, agent_id):
    response = requests.post(
        "https://api-m3waemr5lq-uc.a.run.app/timers",
        headers={
            "x-api-key": api_key,
            "Content-Type": "application/json"
        },
        json={
            "name": f"Agent {agent_id} Workflow Timer",
            "duration": duration,
            "metadata": {
                "agent_id": agent_id,
                "created_by": "autonomous_agent",
                "workflow_type": "data_processing"
            }
        }
    )
    return response.json()
```

### **Pattern 2: Multi-Agent Coordination**
```python
# Agent creates timer for team coordination
def create_coordination_timer(api_key, team_name, next_agent):
    response = requests.post(
        "https://api-m3waemr5lq-uc.a.run.app/timers",
        headers={
            "x-api-key": api_key,
            "Content-Type": "application/json"
        },
        json={
            "name": f"Team {team_name} Handoff",
            "duration": "10m",
            "events": {
                "on_expire": {
                    "webhook": f"https://agent-{next_agent}.yourdomain.com/webhook",
                    "message": f"Your turn, Agent {next_agent}",
                    "data": {
                        "handoff_from": "current_agent",
                        "handoff_to": next_agent,
                        "team": team_name,
                        "context": "coordination_timer"
                    }
                }
            },
            "team": team_name,
            "metadata": {
                "coordination_type": "agent_handoff",
                "next_agent": next_agent
            }
        }
    )
    return response.json()
```

### **Pattern 3: Session-Based Agent Timing**
```python
# Agent creates session-aware timer
def create_session_timer(api_key, session_id, command):
    response = requests.post(
        "https://api-m3waemr5lq-uc.a.run.app/timers",
        headers={
            "x-api-key": api_key,
            "Content-Type": "application/json"
        },
        json={
            "name": f"Session {session_id} Timer",
            "duration": "1h",
            "events": {
                "on_expire": {
                    "webhook": "https://bridge.minoots.com/webhook/your_user_id",
                    "message": f"Execute: {command}",
                    "data": {
                        "command": command,
                        "session_id": session_id,
                        "command_type": "session_targeted_execution"
                    }
                }
            },
            "metadata": {
                "session_id": session_id,
                "automation_type": "session_command"
            }
        }
    )
    return response.json()
```

---

## 🎯 PRICING FOR AGENTS

**Designed specifically for AI agent economics:**

### **🆓 FREE TIER (Always Free)**
- 5 timers per day (anonymous)
- 100 timers per day (with API key)
- Basic webhook notifications
- Perfect for: Testing, small agents, proof-of-concepts

### **💎 AGENT COORDINATION PRO ($19 one-time)**
- **Unlimited timer creation**
- **MCP Server for Claude integration** 🔥
- **Multi-agent coordination sessions**
- **Team broadcasting & collaboration**
- **Advanced webhook configuration**
- **Workflow orchestration**
- Perfect for: Production agents, multi-agent systems

### **🏢 ENTERPRISE ($99 one-time)**
- Everything in Agent Coordination Pro
- **Custom domain API endpoints**
- **Advanced analytics dashboard**
- **SSO integration for team agents**
- **99.9% SLA guarantee**
- **Priority support**
- Perfect for: Large-scale agent deployments, enterprise AI systems

**🎯 Why One-Time Payment**: No subscription fatigue for agents. Pay once, use forever. Perfect for autonomous systems that need predictable costs.

---

## 🚀 ENHANCED FEATURES FOR AGENTS

### **🔥 MCP Integration (Premium)**
- **Native Claude Code integration** through Model Context Protocol
- **Session-targeting timers** that inject commands into your Claude sessions
- **Automatic agent coordination** across multiple Claude instances
- **Premium feature** available in Agent Coordination Pro tier

**See**: `mcp-timer-bridge/CLAUDE.md` for complete MCP integration details

### **🤝 Multi-Agent Coordination**
- **Team broadcasting**: Send messages to all agents in a team
- **Agent handoff patterns**: Coordinate between different agent types
- **Workflow orchestration**: Chain multiple agents with timers
- **Session awareness**: Maintain state across agent restarts

### **📊 Agent Analytics (Enterprise)**
- **Usage patterns**: Understand how your agents use timers
- **Performance metrics**: Timer accuracy and execution stats
- **Team coordination**: Analytics on multi-agent workflows
- **Cost optimization**: Insights for efficient timer usage

---

## 📋 QUICK REFERENCE FOR AGENTS

### **Essential Endpoints**
```bash
# Health check
GET https://api-m3waemr5lq-uc.a.run.app/health

# Create timer
POST https://api-m3waemr5lq-uc.a.run.app/timers

# List timers
GET https://api-m3waemr5lq-uc.a.run.app/timers

# Get timer status
GET https://api-m3waemr5lq-uc.a.run.app/timers/{id}

# Delete timer
DELETE https://api-m3waemr5lq-uc.a.run.app/timers/{id}

# Get API key
POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys
```

### **Duration Formats**
```
"30s"    - 30 seconds
"5m"     - 5 minutes  
"2h"     - 2 hours
"1d"     - 1 day
1800000  - milliseconds
```

### **Response Headers (Anonymous Users)**
```
X-Anonymous-Timers-Used: 2
X-Anonymous-Timers-Remaining: 3
X-Upgrade-At: 5
RateLimit-Limit: 10
RateLimit-Remaining: 8
```

---

## 🛠️ TROUBLESHOOTING FOR AGENTS

### **Common Issues**

**❌ "Rate limit exceeded"**
- **Solution**: Get an API key for higher limits
- **Temp fix**: Wait for rate limit window to reset

**❌ "Authentication required"**
- **Solution**: You've hit anonymous limits, get an API key
- **Command**: Use the API key bootstrap endpoint above

**❌ "Timer not found"**
- **Solution**: Timer may have already expired or been deleted
- **Check**: List all timers to see current state

**❌ "Invalid duration format"**
- **Solution**: Use format like "30s", "5m", "2h", or milliseconds
- **Example**: "1h30m" → "90m" or 5400000

### **Agent-Specific Tips**

1. **Store your API key securely** - Use environment variables
2. **Handle webhook failures** - Currently no automatic retries (webhook enhancement planned)
3. **Use meaningful timer names** - Include agent ID and purpose
4. **Add metadata** - Store agent context for debugging
5. **Monitor usage** - Check response headers for limit tracking

### **Current System Limitations & Security**

**Webhook Behavior (Current Implementation):**
- **Single attempt**: Webhook called once when timer expires
- **No retries**: Failed webhooks are logged but not retried automatically
- **Best practice**: Implement your own retry logic in webhook handler if needed
- **Status**: Check timer status shows 'expired' regardless of webhook success

**Timer Duration Limits:**
- **Current**: No enforced maximum (system dependent)
- **Minimum**: 1 second
- **Format**: Supports "30s", "5m", "2h", "1d" or milliseconds
- **Note**: Very long timers (months/years) not yet tested at scale

**Security Features:**
- **Rate Limiting**: Automatic protection against abuse per IP/API key
- **Input Validation**: Basic sanitization of timer data
- **Access Control**: Timers are isolated by user/organization with RBAC

---

## 🎯 NEXT STEPS FOR AGENTS

1. **Test the basic flow** - Create a timer, wait for it to expire
2. **Get your API key** - Bootstrap higher limits (100/day)
3. **Integrate webhooks** - Set up your agent to receive timer notifications
4. **Upgrade to Pro** - Get advanced MCP features and webhook automation
5. **Join the community** - Share agent patterns and use cases

---

## 📞 SUPPORT FOR AGENTS

- **API Issues**: GitHub issues at https://github.com/Domusgpt/minoots-timer-system
- **Integration Help**: GitHub discussions
- **Agent Patterns**: Share and discover in community discussions

**Built for agents, by developers who understand autonomous systems.**

---

**MINOOTS Timer System** - The metronome for AI agent coordination.