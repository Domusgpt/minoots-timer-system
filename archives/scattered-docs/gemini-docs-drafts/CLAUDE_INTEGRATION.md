# 🧠 MINOOTS CLAUDE INTEGRATION GUIDE

**Connect Claude Desktop to MINOOTS for basic timer coordination in AI workflows.**

---

## 🎯 WHAT THIS ENABLES

With MINOOTS MCP integration, Claude can:

-   **Create timers**: "Set a timer for 30 minutes to remind me about the deployment"
-   **Monitor timers**: "What's the status of my active timers?"
-   **Coordinate basic workflows**: Use timers for sequential tasks.

---

## 🚀 SETUP GUIDE

### Step 1: Get Your MINOOTS API Key

1.  **Sign up**: Visit [minoots.com/signup](https://minoots.com/signup) (Note: MCP integration typically requires a Pro tier or higher).
2.  **Generate API key**: Access your account dashboard to generate an API key. Save it securely.

### Step 2: Install MINOOTS MCP Server

MINOOTS MCP server is part of the main `minoots-timer-system` repository. You can run it from source.

```bash
git clone https://github.com/Domusgpt/minoots-timer-system.git
cd minoots-timer-system/mcp
npm install
```

### Step 3: Configure Claude Desktop

Locate your Claude Desktop configuration file:

-   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
-   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
-   **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the following configuration to the `mcpServers` section:

```json
{
  "mcpServers": {
    "minoots": {
      "command": "node",
      "args": ["/path/to/minoots-timer-system/mcp/index.js"],
      "env": {
        "MINOOTS_API_KEY": "YOUR_API_KEY",
        "MINOOTS_BASE_URL": "https://api-m3waemr5lq-uc.a.run.app"
      }
    }
  }
}
```

### Step 4: Restart Claude Desktop

1.  **Quit Claude completely**.
2.  **Restart Claude Desktop**.
3.  **Test connection**: Ask Claude "What timer tools do you have available?"

---

## 🛠️ AVAILABLE TOOLS

Once connected, Claude has access to these MINOOTS tools:

### 🕒 `create_timer`
Create a new timer with optional webhook notifications.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Name for the timer" },
    "duration": { "type": "string", "description": "Timer duration (e.g., \"30s\", \"5m\", \"2h\")" },
    "agent_id": { "type": "string", "description": "ID of the agent creating the timer (optional)" },
    "team": { "type": "string", "description": "Team name for coordination (optional)" },
    "webhook": { "type": "string", "description": "Webhook URL to call when timer expires (optional)" },
    "message": { "type": "string", "description": "Message to send when timer expires (optional)" },
    "metadata": { "type": "object", "description": "Additional metadata for the timer (optional)" }
  },
  "required": ["name", "duration"]
}
```

### 📋 `list_timers`
List all timers with optional filtering.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "agent_id": { "type": "string", "description": "Filter by agent ID (optional)" },
    "team": { "type": "string", "description": "Filter by team name (optional)" },
    "status": { "type": "string", "description": "Filter by status: running, expired (optional)" }
  }
}
```

### 🔍 `get_timer`
Get details and current status of a specific timer.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "timer_id": { "type": "string", "description": "ID of the timer to retrieve" }
  },
  "required": ["timer_id"]
}
```

### 🗑️ `delete_timer`
Delete a specific timer.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "timer_id": { "type": "string", "description": "ID of the timer to delete" }
  },
  "required": ["timer_id"]
}
```

### ⏳ `quick_wait`
Create a simple wait timer for agent coordination.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "duration": { "type": "string", "description": "Wait duration (e.g., \"30s\", \"5m\")" },
    "name": { "type": "string", "description": "Optional name for the wait timer" },
    "agent_id": { "type": "string", "description": "ID of the waiting agent" }
  },
  "required": ["duration"]
}
```

### 📢 `broadcast_to_team`
Send a message to all agents in a team. This uses the `/teams/{teamName}/broadcast` API endpoint.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "team": { "type": "string", "description": "Team name to broadcast to" },
    "message": { "type": "string", "description": "Message to broadcast" },
    "data": { "type": "object", "description": "Additional data to include (optional)" }
  },
  "required": ["team", "message"]
}
```

### 🤝 `agent_coordination_session`
Create a coordination session for multiple agents. This tool creates multiple timers for coordinated work.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "session_name": { "type": "string", "description": "Name for the coordination session" },
    "agents": { "type": "array", "items": { "type": "string" }, "description": "List of agent IDs to coordinate" },
    "workflow": { "type": "object", "description": "Workflow definition with steps and timings (optional)" }
  },
  "required": ["session_name", "agents"]
}
```

### 💚 `check_api_health`
Check if MINOOTS API is responding.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {}
}
```

---

## 💡 REAL-WORLD USE CASES

### Case 1: Development Workflow Coordination

**You**: "I'm starting a 2-hour deep work session. Create a timer."

**Claude**:
```
I'll create a 2-hour deep work timer.

[Uses create_timer]
✅ Created "Deep Work Session" - 2h timer
⏰ Timer ID: timer_abc123
📍 Will expire at [timestamp]
```

### Case 2: API Rate Limit Management

**You**: "I hit my API limit, create a timer to retry in 1 hour."

**Claude**:
```
I'll create a timer to remind you to retry your API call.

[Uses create_timer]
✅ Created "API Retry Reminder" - 1h timer
🔄 Will notify you when ready to retry
```

### Case 3: Team Sprint Coordination

**You**: "We're starting a 3-day sprint. Set up a timer for it."

**Claude**:
```
I'll set up a 3-day sprint timer.

[Uses create_timer]
✅ Sprint Timer: 3 days (ends [date/time])
```

---

## 🚨 TROUBLESHOOTING

### Problem: "MINOOTS tools not available"

**Causes**:
-   MCP server not properly configured or running.
-   Invalid API key.
-   Claude Desktop not restarted.

**Solutions**:
1.  Check `claude_desktop_config.json` syntax and paths.
2.  Verify your API key is correct and active.
3.  Restart Claude Desktop completely.
4.  Check the MCP server's console for errors.

### Problem: "Permission denied" errors

**Causes**:
-   Your MINOOTS account tier does not support the requested operation.
-   Invalid API key.

**Solutions**:
1.  Check your MINOOTS account tier and upgrade if necessary.
2.  Verify your API key is correct.

---

## 💰 PRICING NOTE

**MCP integration requires a Pro tier or higher** because it enables advanced automation and interaction capabilities.

[Upgrade at minoots.com/pricing](https://minoots.com/pricing)

---

**🎉 You're now ready to use MINOOTS with Claude for sophisticated timer coordination in your AI workflows!**

**Need help? Email [support@minoots.com](mailto:support@minoots.com) or ask Claude to test the integration.**
