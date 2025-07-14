# 🤖 MINOOTS for AI Agents - Visual Guide

**The problem-solving timer system built specifically for AI agents**

---

## 🤔 THE PROBLEM MINOOTS SOLVES

### **Before MINOOTS (The Pain):**
```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR CURRENT SITUATION                   │
│                                                             │
│  You: "I need to check this API in 30 minutes"             │
│                                                             │
│  Options:                                                   │
│  ❌ setTimeout() → Dies if process crashes                  │
│  ❌ Phone alarm → You have to manually do it               │
│  ❌ Cron job → Complex setup, not dynamic                  │
│  ❌ Remember → You forget, work gets interrupted           │
│                                                             │
│  Result: Unreliable, manual, breaks your workflow          │
└─────────────────────────────────────────────────────────────┘
```

### **After MINOOTS (The Solution):**
```
┌─────────────────────────────────────────────────────────────┐
│                      WITH MINOOTS                          │
│                                                             │
│  You: "Set timer for 30min to check the API"               │
│                                                             │
│  What happens:                                              │
│  ✅ Timer runs in the cloud (survives crashes)             │
│  ✅ Automatically calls your webhook when done             │
│  ✅ Can execute commands or send data                      │
│  ✅ Works with any AI agent or automation                  │
│                                                             │
│  Result: Reliable, automatic, enhances your workflow       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 5-MINUTE GETTING STARTED

### **Step 1: Test That MINOOTS Works**
```bash
# Just copy and paste this:
curl https://api-m3waemr5lq-uc.a.run.app/health
```
**You should see:** `{"status":"healthy",...}`

### **Step 2: Create Your First Timer (No Setup Required)**
```bash
# Copy this and change the webhook URL to yours:
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Test Timer",
    "duration": "30s",
    "events": {
      "on_expire": {
        "webhook": "https://webhook.site/YOUR-UNIQUE-URL-HERE",
        "message": "Your first MINOOTS timer worked!"
      }
    }
  }'
```

**What this does:**
- Creates a 30-second timer
- When it expires, sends a POST request to your webhook URL
- Includes the message "Your first MINOOTS timer worked!"

### **Step 3: Wait 30 Seconds and Check Your Webhook**
You should receive something like this:
```json
{
  "event": "timer_expired",
  "timer": {
    "id": "abc-123-def",
    "name": "My First Test Timer",
    "status": "expired"
  },
  "message": "Your first MINOOTS timer worked!"
}
```

**🎉 If you got the webhook, MINOOTS is working for you!**

---

## 💡 PRACTICAL USE CASES FOR AGENTS

### **Use Case 1: Automatic Code Commits**
```
Problem: You're coding and forget to commit your work
Solution: Set a timer to auto-commit every hour

┌─────────────────┐     ⏰ 1 Hour      ┌─────────────────┐
│                 │     Timer          │                 │
│ You: Start      │ ─────────────────▶ │ MINOOTS: Runs   │
│ coding session  │                    │ "git commit"    │
│                 │                    │ automatically   │
└─────────────────┘                    └─────────────────┘
```

### **Use Case 2: API Monitoring**
```
Problem: Need to check if your deployed service is still running
Solution: Set recurring timers to ping your API

┌─────────────────┐     ⏰ Every       ┌─────────────────┐
│                 │     30 Minutes     │                 │
│ Deploy your     │ ─────────────────▶ │ MINOOTS: Checks │
│ application     │                    │ health endpoint │
│                 │                    │ & alerts you    │
└─────────────────┘                    └─────────────────┘
```

### **Use Case 3: Multi-Step Workflows**
```
Problem: You have a complex process with waiting periods
Solution: Chain timers to automate the entire workflow

Step 1: Data Processing (30 min)
┌─────────────────┐     ⏰ 30min       ┌─────────────────┐
│ Start data      │ ─────────────────▶ │ Trigger analysis│
│ processing      │                    │ script          │
└─────────────────┘                    └─────────────────┘

Step 2: Analysis Complete (20 min)
┌─────────────────┐     ⏰ 20min       ┌─────────────────┐
│ Analysis runs   │ ─────────────────▶ │ Generate report │
│ automatically   │                    │ and send email  │
└─────────────────┘                    └─────────────────┘
```

---

## 🔧 HOW TO INTEGRATE WITH YOUR AGENT

### **Option 1: Simple HTTP Requests (Any Language)**
```python
import requests

# Create a timer
response = requests.post(
    "https://api-m3waemr5lq-uc.a.run.app/timers",
    json={
        "name": "Check database backup",
        "duration": "24h",
        "events": {
            "on_expire": {
                "webhook": "https://your-agent.com/webhook",
                "message": "Time to check backup status"
            }
        }
    }
)

timer_id = response.json()["timer"]["id"]
print(f"Timer created: {timer_id}")
```

### **Option 2: Claude Code MCP Integration (Premium)**
```
You: "Set a 2-hour timer to deploy staging"

Claude (with MINOOTS MCP): 
"I'll create a timer that will automatically run your staging 
deployment script in 2 hours. Timer ID: abc-123"

┌─────────────────┐     ⏰ 2 Hours     ┌─────────────────┐
│                 │                    │                 │
│ You continue    │ ─────────────────▶ │ "npm run        │
│ working on      │                    │  deploy:staging"│
│ other things    │                    │ runs in your    │
│                 │                    │ terminal        │
└─────────────────┘                    └─────────────────┘
```

**What makes this special:**
- Timer runs in the cloud (doesn't depend on your computer)
- Can execute commands in your actual working directory
- Integrates with your existing Claude Code workflow

---

## 📊 PRICING FOR AGENTS

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   FREE TIER     │  │  PRO ($19 once) │  │ ENTERPRISE ($99)│
│                 │  │                 │  │                 │
│ • 5 timers/day  │  │ • Unlimited     │  │ • Everything    │
│   (anonymous)   │  │   timers        │  │   in Pro        │
│ • 100 timers/   │  │ • MCP Claude    │  │ • Custom domain │
│   day (API key) │  │   integration   │  │ • 99.9% SLA     │
│ • Basic         │  │ • Advanced      │  │ • Priority      │
│   webhooks      │  │   webhooks      │  │   support       │
│                 │  │ • Multi-agent   │  │ • Analytics     │
│                 │  │   coordination  │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Why one-time payments?**
- No subscription fatigue for agents
- Predictable costs for automation
- Pay once, use forever

---

## ⚡ COMMON PATTERNS FOR AGENTS

### **Pattern 1: Simple Reminder**
```bash
# Set a reminder to do something
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Meeting reminder",
    "duration": "15m",
    "events": {
      "on_expire": {
        "webhook": "https://your-agent.com/meeting-alert"
      }
    }
  }'
```

### **Pattern 2: Recurring Check**
```bash
# Check something every hour
# (Create new timer in your webhook handler to make it recurring)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hourly health check",
    "duration": "1h",
    "events": {
      "on_expire": {
        "webhook": "https://your-agent.com/health-check",
        "data": {
          "action": "check_health",
          "next_check": "create_new_timer"
        }
      }
    }
  }'
```

### **Pattern 3: Workflow Step**
```bash
# Part of a multi-step process
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Workflow step 2",
    "duration": "30m",
    "events": {
      "on_expire": {
        "webhook": "https://your-agent.com/next-step",
        "data": {
          "workflow_id": "wf_123",
          "step": 2,
          "previous_result": "step_1_completed"
        }
      }
    }
  }'
```

---

## 🔍 AUTHENTICATION OPTIONS EXPLAINED

### **Anonymous (Start Here)**
- Just start making API calls
- 5 timers per day limit
- Perfect for testing

### **API Key (Recommended)**
```bash
# Get an API key (works even anonymously!)
curl -X POST https://api-m3waemr5lq-uc.a.run.app/account/api-keys \
  -H "Content-Type: application/json" \
  -d '{"name": "My Agent Key"}'

# Then use it in your requests:
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "x-api-key: mnt_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{ ... timer config ... }'
```

### **Firebase Auth (Advanced)**
- For team features and organizations
- Required for enterprise features
- Use when you need user management

---

## 🚨 TROUBLESHOOTING

### **"Rate limit exceeded"**
- **Problem:** You've hit the free tier limit
- **Solution:** Get an API key for higher limits

### **"Timer not found"**
- **Problem:** Timer may have already expired
- **Solution:** List all timers to check status:
```bash
curl https://api-m3waemr5lq-uc.a.run.app/timers
```

### **Webhook not receiving data**
- **Problem:** Your webhook URL might be wrong
- **Solution:** Test with webhook.site first
- **Check:** MINOOTS will retry failed webhooks

### **"Invalid duration format"**
- **Problem:** Duration format is wrong
- **Solution:** Use: "30s", "5m", "2h", "1d", or milliseconds

---

## 💪 READY TO START?

1. **Test the health endpoint** (30 seconds)
2. **Create your first timer** with webhook.site (2 minutes)
3. **Get an API key** for unlimited usage (1 minute)
4. **Integrate with your agent** using the examples above

**No complex setup, no infrastructure management, just reliable timers for your agents.**

---

**Questions?** Check GitHub: https://github.com/Domusgpt/minoots-timer-system