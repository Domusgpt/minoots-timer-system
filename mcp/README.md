# MINOOTS MCP Server

Model Context Protocol (MCP) server for MINOOTS Independent Timer System. This enables Claude agents to create, monitor, and coordinate timers directly through natural conversation.

## Features

### Basic Timer Operations
- ✅ **Create Timer** - Set timers with custom durations and webhooks
- ✅ **Monitor Progress** - Check timer status and remaining time
- ✅ **List Timers** - View all active timers with filtering
- ✅ **Delete Timers** - Remove timers when no longer needed

### Agent Coordination
- ✅ **Quick Wait** - Simple wait timers for agent synchronization
- ✅ **Team Broadcast** - Send messages to team members
- ✅ **Coordination Sessions** - Multi-agent workflow orchestration
- ✅ **API Health Check** - Verify MINOOTS service status

## Installation

### Step 1: Install Dependencies
```bash
cd mcp
npm install
```

### Step 2: Configure Claude Desktop

Add this configuration to your Claude Desktop settings:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\\Claude\\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "minoots-timer-system": {
      "command": "node",
      "args": ["/absolute/path/to/minoots-timer-system/mcp/index.js"],
      "env": {
        "MINOOTS_API_BASE": "https://api-m3waemr5lq-uc.a.run.app"
      }
    }
  }
}
```

**Important:** Replace `/absolute/path/to/` with the actual path to your MINOOTS installation.

### Step 3: Restart Claude Desktop

After adding the configuration, restart Claude Desktop to load the MCP server.

## Usage Examples

Once configured, you can use natural language to interact with timers:

### Basic Timer Creation
```
"Create a 5-minute timer called 'coffee break' for agent_1"
```

### Agent Coordination
```
"Set up a coordination session for agents alice, bob, and charlie"
```

### Monitoring
```
"Show me all timers for team 'development'"
```

### Quick Synchronization
```
"Wait 30 seconds before continuing"
```

## Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_timer` | Create a new timer | name, duration, agent_id, team, webhook, message |
| `get_timer` | Get timer details | timer_id |
| `list_timers` | List timers with filtering | agent_id, team, status |
| `delete_timer` | Delete a timer | timer_id |
| `quick_wait` | Create simple wait timer | duration, name, agent_id |
| `broadcast_to_team` | Send team message | team, message, data |
| `agent_coordination_session` | Multi-agent coordination | session_name, agents, workflow |
| `check_api_health` | Check API status | none |

## Duration Formats

MINOOTS accepts various duration formats:
- `"30s"` - 30 seconds
- `"5m"` - 5 minutes  
- `"2h"` - 2 hours
- `"1d"` - 1 day
- `300000` - milliseconds (raw number)

## Advanced Features

### Webhook Notifications
```javascript
// Timers can trigger webhooks when they expire
{
  "name": "deployment_timer",
  "duration": "10m",
  "webhook": "https://my-app.com/deployment-complete",
  "message": "Deployment timer expired - check status"
}
```

### Team Coordination
```javascript
// Coordinate multiple agents on the same team
{
  "team": "backend_team",
  "agents": ["db_agent", "api_agent", "cache_agent"]
}
```

### Metadata Tracking
```javascript
// Add custom metadata to timers
{
  "name": "data_processing",
  "duration": "1h",
  "metadata": {
    "task_type": "etl",
    "priority": "high",
    "dataset": "user_analytics"
  }
}
```

## Testing

Run the MCP server test suite:

```bash
cd mcp
npm test
```

This will verify:
- ✅ MCP protocol compliance
- ✅ Tool registration
- ✅ API connectivity
- ✅ Basic functionality

## Troubleshooting

### Server Not Starting
1. Check Node.js version (requires 18+)
2. Verify path in Claude Desktop config
3. Check console logs in Claude Desktop

### API Connection Issues
1. Verify MINOOTS API is running: https://api-m3waemr5lq-uc.a.run.app/health
2. Check network connectivity
3. Verify API base URL in environment

### Tool Not Available
1. Restart Claude Desktop after config changes
2. Check MCP server logs
3. Verify JSON syntax in config file

## Development

### Adding New Tools
1. Add tool definition to `ListToolsRequestSchema` handler
2. Implement tool logic in `CallToolRequestSchema` handler
3. Add tests in `test/mcp-test.js`
4. Update documentation

### Local Development
```bash
# Run in development mode with auto-reload
npm run dev

# Test individual tools
npm run test
```

## License

Proprietary - Paul Phillips (phillips.paul.email@gmail.com)

## Support

- GitHub Issues: https://github.com/Domusgpt/minoots-timer-system/issues
- Live API: https://api-m3waemr5lq-uc.a.run.app
- Main Documentation: https://github.com/Domusgpt/minoots-timer-system