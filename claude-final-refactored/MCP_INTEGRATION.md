# MCP Integration Guide

**Connect MINOOTS to Claude Desktop for native timer management**

## Prerequisites

- **MINOOTS Pro tier** required (verified in index.js line 444)
- **API key** starting with `mnt_` 
- Claude Desktop app installed

## Installation

### Step 1: Get MCP Configuration

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  https://api-m3waemr5lq-uc.a.run.app/mcp/config
```

Response (verified from index.js lines 445-458):
```json
{
  "success": true,
  "mcpServer": {
    "command": "node",
    "args": ["/path/to/functions/mcp/index.js"],
    "env": {
      "MINOOTS_API_BASE": "https://api-m3waemr5lq-uc.a.run.app"
    }
  },
  "message": "Add this configuration to your Claude Desktop settings"
}
```

### Step 2: Configure Claude Desktop

1. Open Claude Desktop settings
2. Navigate to MCP Servers section
3. Add MINOOTS configuration
4. Restart Claude Desktop

## Available MCP Tools

**Verified from mcp/index.js lines 72-236**:

### 1. create_timer
Create a new timer with optional webhook.

**Parameters**:
- `name` (required): Timer name
- `duration` (required): Duration like "30s", "5m", "2h"  
- `agent_id`: Agent identifier
- `team`: Team name for coordination
- `webhook`: URL to call on expiration
- `message`: Message for webhook
- `metadata`: Custom metadata object

### 2. get_timer
Get timer details and current status.

**Parameters**:
- `timer_id` (required): Timer ID to retrieve

### 3. list_timers
List all accessible timers.

**Parameters**:
- `agent_id`: Filter by agent
- `team`: Filter by team
- `status`: Filter by "running" or "expired"

### 4. delete_timer
Delete a specific timer.

**Parameters**:
- `timer_id` (required): Timer ID to delete

### 5. quick_wait
Simple delay timer for coordination.

**Parameters**:
- `duration` (required): Wait duration
- `name`: Optional timer name
- `agent_id`: Waiting agent ID

### 6. broadcast_to_team
Send message to team members.

**Parameters**:
- `team` (required): Team name
- `message` (required): Message text
- `data`: Additional data object

## Usage Examples in Claude

Once configured, use natural language:

```
"Create a 5 minute timer called 'deployment cooldown'"
"List all running timers for my team"
"Wait 30 seconds before proceeding"
"Delete timer abc123"
```

Claude will automatically use the appropriate MCP tools.

## Authentication

**⚠️ CRITICAL BUG**: The MCP server currently has NO authentication configured. All API calls will fail.

**Issue**: `makeAPIRequest()` in mcp/index.js missing x-api-key header. See IMPLEMENTATION_BACKLOG.md for fix.

## Troubleshooting

### MCP not available
- Verify Pro tier subscription active
- Check API key starts with `mnt_`
- Restart Claude Desktop after configuration

### Connection errors
- Verify API endpoint is accessible
- Check firewall/proxy settings
- Ensure API key has MCP permissions

### Tools not showing
- Update Claude Desktop to latest version
- Verify MCP server configuration syntax
- Check Claude Desktop logs for errors

---

**Changes from Previous Versions:**
- ✅ **Verified against actual code** - All tools and parameters from mcp/index.js
- ✅ **Correct tier requirement** - Pro tier verified in index.js
- ✅ **Real MCP endpoint** - `/mcp/config` endpoint exists
- ✅ **Accurate tool schemas** - Matched exactly to implementation
- ❓ **Unknown**: Actual MCP server path in response (shows placeholder)