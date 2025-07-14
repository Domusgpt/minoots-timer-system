# Claude Desktop Integration (MCP)

**Use MINOOTS timers directly in Claude Desktop**

## Overview

MINOOTS provides an MCP (Model Context Protocol) server that gives Claude Desktop direct access to timer functionality. This lets you create timers, check status, and manage workflows without leaving Claude.

## Setup

### 1. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "minoots-timer-system": {
      "command": "node",
      "args": ["/path/to/minoots-timer-system/mcp/index.js"],
      "env": {
        "MINOOTS_API_KEY": "your_api_key_here",
        "MINOOTS_API_URL": "https://api-m3waemr5lq-uc.a.run.app"
      }
    }
  }
}
```

### 2. Install Dependencies

```bash
cd /path/to/minoots-timer-system/mcp
npm install
```

### 3. Test the Integration

Restart Claude Desktop and verify the MCP tools are available.

## Available Tools

The MCP server provides these tools for Claude:

### create_timer
Create a new timer.

**Parameters:**
- `duration` (required) - Timer duration (e.g., "30s", "5m", "2h")
- `name` (optional) - Timer name
- `webhook` (optional) - Webhook URL to notify
- `metadata` (optional) - Custom data object

### list_timers
List all timers for the authenticated user.

**Parameters:**
- `status` (optional) - Filter by status (running, expired, cancelled)

### get_timer
Get details for a specific timer.

**Parameters:**
- `timer_id` (required) - The timer ID

### delete_timer
Cancel and delete a timer.

**Parameters:**
- `timer_id` (required) - The timer ID

### broadcast_to_team
Send a message to team members (if team features are configured).

**Parameters:**
- `team_id` (required) - Team ID
- `message` (required) - Message to broadcast

## Example Use Cases

### Rate Limiting
"Create a 5-minute cooldown timer for the API rate limit"

Claude will use the `create_timer` tool to set up the timer.

### Workflow Orchestration  
"Set a 30-minute timeout for this data processing task"

Claude can create timers to manage workflow timeouts.

### Reminders
"Remind me in 2 hours to check the deployment status"

Claude can create reminder timers with appropriate webhooks.

### Multi-Agent Coordination
"Create a coordination timer for 10 minutes to synchronize with other agents"

Claude can use timers for agent coordination patterns.

## Configuration

### Required Environment Variables

- `MINOOTS_API_KEY` - Your MINOOTS API key
- `MINOOTS_API_URL` - API endpoint (default: https://api-m3waemr5lq-uc.a.run.app)

### Optional Configuration

- Timer names are automatically generated if not provided
- Webhook URLs can be omitted for fire-and-forget timers
- Metadata can include agent coordination information

## Limitations

- **No progress webhooks** - Only timer expiration is supported
- **Basic webhook payload** - Simple JSON format only
- **No retry logic** - Webhooks are fire-and-forget
- **Single webhook per timer** - No multiple notifications

## Troubleshooting

### MCP server not starting
- Check Node.js is installed and accessible
- Verify file paths in claude_desktop_config.json
- Check API key is set correctly

### Tools not available in Claude
- Restart Claude Desktop after config changes
- Check MCP server logs for errors
- Verify dependencies are installed

### API errors
- Verify API key is valid
- Check MINOOTS_API_URL is correct
- Test API directly with curl

## Advanced Usage

### Custom Webhooks
You can create timers with webhooks that integrate with your own systems:

```json
{
  "duration": "1h",
  "name": "Build timeout",
  "webhook": "https://your-ci-system.com/api/build/timeout",
  "metadata": {
    "build_id": "build_123",
    "agent_id": "claude_agent_1"
  }
}
```

### Team Coordination
Use broadcast functionality for multi-agent workflows:

```json
{
  "team_id": "team_123", 
  "message": "Phase 1 complete, proceeding to phase 2"
}
```

*Note: Team features require proper organization setup and may not be fully configured*