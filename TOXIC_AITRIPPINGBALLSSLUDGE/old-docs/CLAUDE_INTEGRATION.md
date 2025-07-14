# 🧠 MINOOTS CLAUDE INTEGRATION GUIDE

**Connect Claude Desktop to MINOOTS for native timer coordination in AI workflows.**

---

## 🎯 WHAT THIS ENABLES

With MINOOTS MCP integration, Claude can:

- **Create timers**: "Set a timer for 30 minutes to remind me about the deployment"
- **Monitor timers**: "What's the status of my active timers?"
- **Coordinate workflows**: "Create a 2-hour sprint timer with team notifications"
- **Handle rate limits**: "I hit my API limit, create a timer to retry in 1 hour"

---

## 🚀 SETUP GUIDE

### Step 1: Get Your MINOOTS API Key

1. **Sign up**: Visit [minoots.com/signup](https://minoots.com/signup)
2. **Upgrade to Pro**: MCP integration requires Pro tier ($19/month)
3. **Generate API key**: Dashboard → API Keys → Generate New Key
4. **Save securely**: You'll need this for the MCP server

### Step 2: Install MINOOTS MCP Server

#### Option A: NPM Package (Recommended)
```bash
npm install -g @minoots/mcp-server
```

#### Option B: Clone from Source
```bash
git clone https://github.com/Domusgpt/minoots-timer-system.git
cd minoots-timer-system/mcp
npm install
```

### Step 3: Configure Claude Desktop

#### Find Your Claude Config
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

#### Add MINOOTS MCP Server
```json
{
  "mcpServers": {
    "minoots": {
      "command": "node",
      "args": ["/path/to/minoots-timer-system/mcp/index.js"],
      "env": {
        "MINOOTS_API_KEY": "mnt_live_your_api_key_here",
        "MINOOTS_BASE_URL": "https://api-m3waemr5lq-uc.a.run.app"
      }
    }
  }
}
```

#### If Using NPM Global Install
```json
{
  "mcpServers": {
    "minoots": {
      "command": "minoots-mcp",
      "env": {
        "MINOOTS_API_KEY": "mnt_live_your_api_key_here"
      }
    }
  }
}
```

### Step 4: Restart Claude Desktop

1. **Quit Claude completely**
2. **Restart Claude Desktop**
3. **Look for MINOOTS tools** in the tools panel
4. **Test connection**: Ask Claude "What timer tools do you have available?"

---

## 🛠️ AVAILABLE TOOLS

Once connected, Claude has access to these MINOOTS tools:

### 🕒 `create_timer`
Create a new timer with webhook notifications.

**Example**: "Create a 45-minute pomodoro timer"

```
Claude will use: create_timer
- name: "Pomodoro Session"
- duration: "45m" 
- webhook: (optional notification URL)
```

### 📋 `list_timers`
View all active, expired, and cancelled timers.

**Example**: "Show me all my current timers"

```
Claude will use: list_timers
Returns: List of timers with status and progress
```

### 🔍 `get_timer`
Get detailed information about a specific timer.

**Example**: "What's the status of timer abc123?"

```
Claude will use: get_timer
- timer_id: "abc123"
Returns: Detailed timer info with progress percentage
```

### ⏹️ `cancel_timer`
Cancel a running timer before it expires.

**Example**: "Cancel the build timeout timer"

```
Claude will use: cancel_timer
- timer_id: "identified from previous context"
- reason: "Build completed successfully"
```

### ⚡ `quick_wait`
Create a simple delay timer without webhooks.

**Example**: "Wait 5 minutes then continue"

```
Claude will use: quick_wait
- duration: "5m"
- message: "5 minute delay completed"
```

### 👥 `team_broadcast`
Send notifications to team channels (Team tier).

**Example**: "Notify the dev team that deployment is starting"

```
Claude will use: team_broadcast
- team: "dev-team"
- message: "Deployment starting now"
- webhook: "https://slack.com/webhook/dev-team"
```

### 📊 `get_usage`
Check your current MINOOTS usage and limits.

**Example**: "How many timers have I used this month?"

```
Claude will use: get_usage
Returns: Usage statistics and tier information
```

### 🏥 `health_check`
Verify MINOOTS API connectivity and status.

**Example**: "Is MINOOTS working properly?"

```
Claude will use: health_check
Returns: System status and connectivity info
```

---

## 💡 REAL-WORLD USE CASES

### Case 1: Development Workflow Coordination

**You**: "I'm starting a 2-hour deep work session. Create a timer and set up break reminders."

**Claude**: 
```
I'll create a 2-hour deep work timer with break reminders.

[Uses create_timer]
✅ Created "Deep Work Session" - 2h timer
⏰ Timer ID: timer_abc123
📍 Will expire at 3:30 PM

Would you like me to also create 25-minute break reminder timers?
```

### Case 2: API Rate Limit Management

**You**: "I hit the GitHub API rate limit. Handle the retry logic."

**Claude**:
```
I'll create a timer to retry your GitHub API call when the rate limit resets.

[Uses create_timer]
✅ Created "GitHub API Retry" - 1h timer
🔄 Will automatically retry your request at 2:45 PM
📧 You'll get a webhook notification when ready

What GitHub operation should I retry when the timer expires?
```

### Case 3: Team Sprint Coordination

**You**: "We're starting a 3-day sprint. Set up the coordination timers."

**Claude**:
```
I'll set up your 3-day sprint with daily standup reminders.

[Uses create_timer multiple times]
✅ Sprint Timer: 3 days (ends Friday 5 PM)
✅ Daily Standup: Every day at 9 AM  
✅ Sprint Review: Friday at 4 PM
📢 Team notifications configured for #dev-team

All timers created with Slack notifications enabled.
```

### Case 4: Long-Running Process Monitoring

**You**: "Monitor this data migration job - it should take 4-6 hours max."

**Claude**:
```
I'll create monitoring timers for your data migration.

[Uses create_timer]
✅ Migration Timeout: 6h timer (safety limit)
✅ Progress Check: Every 2h for status updates
📊 Will notify you if migration exceeds expected time

You'll get progress updates at 2h, 4h, and completion/timeout.
```

---

## 🔧 ADVANCED CONFIGURATION

### Custom Webhook Integration

```json
{
  "mcpServers": {
    "minoots": {
      "command": "node",
      "args": ["/path/to/minoots-timer-system/mcp/index.js"],
      "env": {
        "MINOOTS_API_KEY": "mnt_live_your_api_key_here",
        "MINOOTS_BASE_URL": "https://api-m3waemr5lq-uc.a.run.app",
        "DEFAULT_WEBHOOK_URL": "https://your-app.com/minoots-webhook",
        "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/...",
        "DISCORD_WEBHOOK_URL": "https://discord.com/api/webhooks/..."
      }
    }
  }
}
```

### Multiple Environment Support

```json
{
  "mcpServers": {
    "minoots-prod": {
      "command": "node",
      "args": ["/path/to/minoots-timer-system/mcp/index.js"],
      "env": {
        "MINOOTS_API_KEY": "mnt_live_production_key",
        "MINOOTS_BASE_URL": "https://api-m3waemr5lq-uc.a.run.app"
      }
    },
    "minoots-dev": {
      "command": "node", 
      "args": ["/path/to/minoots-timer-system/mcp/index.js"],
      "env": {
        "MINOOTS_API_KEY": "mnt_test_development_key",
        "MINOOTS_BASE_URL": "https://dev-api.minoots.com"
      }
    }
  }
}
```

---

## 🧪 TESTING YOUR SETUP

### 1. Verify Connection
Ask Claude: **"What timer tools do you have available?"**

Expected response: Claude should list the 8 MINOOTS tools.

### 2. Create Test Timer
Ask Claude: **"Create a 30-second test timer"**

Expected: Timer created successfully with ID provided.

### 3. Check Timer Status
Ask Claude: **"What's the status of my timers?"**

Expected: List showing your test timer and current progress.

### 4. Test Webhook (Optional)
Ask Claude: **"Create a 1-minute timer with webhook notification to https://webhook.site/[your-unique-url]"**

Expected: Webhook should fire after 1 minute.

---

## 🚨 TROUBLESHOOTING

### Problem: "MINOOTS tools not available"

**Causes**:
- MCP server not properly configured
- Invalid API key
- Claude Desktop not restarted

**Solutions**:
1. Check `claude_desktop_config.json` syntax
2. Verify API key is valid (test at minoots.com/dashboard)
3. Restart Claude Desktop completely
4. Check MCP server logs for errors

### Problem: "Permission denied" errors

**Causes**:
- Free tier trying to use Pro features
- Invalid API key
- Rate limiting

**Solutions**:
1. Upgrade to Pro tier at minoots.com/pricing
2. Generate new API key
3. Check usage limits in dashboard

### Problem: Timers not being created

**Causes**:
- Network connectivity issues
- MINOOTS API downtime
- Invalid parameters

**Solutions**:
1. Test API directly: `curl https://api-m3waemr5lq-uc.a.run.app/health`
2. Check [status.minoots.com](https://status.minoots.com) for outages
3. Verify API key permissions

### Problem: Webhooks not firing

**Causes**:
- Invalid webhook URL
- Webhook endpoint not responding
- MINOOTS webhook retry exhausted

**Solutions**:
1. Test webhook URL manually
2. Check webhook endpoint logs
3. Use webhook.site for testing
4. Check MINOOTS delivery logs in dashboard

---

## 📚 EXAMPLE CONVERSATIONS

### Basic Timer Creation

**You**: "I need to step away for 15 minutes. Create a timer to remind me to check on the deployment."

**Claude**: "I'll create a 15-minute timer to remind you about the deployment check.

[Uses create_timer with name: "Deployment Check Reminder", duration: "15m"]

✅ Timer created successfully
⏰ Timer ID: timer_def456
📅 Will expire at 2:45 PM
🔔 You'll receive a notification when it's time to check the deployment"

### Complex Workflow Management

**You**: "Set up a code review workflow. Give reviewers 24 hours, then escalate to team lead if not completed."

**Claude**: "I'll set up a code review workflow with automatic escalation.

[Uses create_timer for initial review period]
✅ Code Review Timer: 24h deadline
[Uses create_timer for escalation reminder] 
✅ Escalation Timer: 22h (2h warning to reviewers)
📧 Escalation webhook configured for team lead
📋 Workflow ID: workflow_review_789

The reviewers have until tomorrow at 2 PM. Team lead will be automatically notified if review isn't complete by 12 PM tomorrow."

---

## 🚀 ADVANCED PATTERNS

### Multi-Stage Deployment Timer
```
"Create a deployment pipeline with staging (30m), testing (45m), and production (60m) timers"
```

### Pomodoro Productivity System
```
"Set up a pomodoro system: 25m work, 5m break, repeat 4 times, then 30m long break"
```

### SLA Monitoring
```
"Monitor our API response times. Create escalation timers if P95 latency exceeds 200ms for more than 10 minutes"
```

### Meeting Management
```
"We have a 2-hour workshop. Create timers for each 30-minute segment with 5-minute transition warnings"
```

---

## 💰 PRICING NOTE

**MCP integration requires Pro tier** ($19/month) because it uses advanced webhook features and unlimited timer creation.

**Upgrade benefits**:
- Unlimited timers
- Advanced webhooks with retry logic
- 90-day timer history  
- Priority support
- MCP/Claude integration

[Upgrade at minoots.com/pricing](https://minoots.com/pricing)

---

**🎉 You're now ready to use MINOOTS with Claude for sophisticated timer coordination in your AI workflows!**

**Need help? Email [support@minoots.com](mailto:support@minoots.com) or ask Claude to test the integration.**