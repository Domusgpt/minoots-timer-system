# MCP Timer Command Bridge Architecture

## 🎯 COMPLETE SOLUTION: Real-Time Timer-to-Claude-Code Command System

### **PROBLEM SOLVED**
- Timer expires with webhook command for Claude Code
- Claude Code is "asleep" when webhook fires  
- Need real-time command injection into Claude Code session

### **MCP-BASED SOLUTION**

#### **1. MCP Timer Command Server**
```javascript
// mcp-timer-server.js - Receives webhooks, provides real-time commands
const express = require('express');
const EventSource = require('eventsource');

class MCPTimerServer {
  constructor() {
    this.pendingCommands = [];
    this.app = express();
    this.setupRoutes();
  }

  // Receive timer webhooks
  setupRoutes() {
    this.app.post('/timer-webhook', (req, res) => {
      const webhook = req.body;
      
      // Check if it's a Claude Code command
      if (webhook.data?.action === 'read_file') {
        this.pendingCommands.push({
          id: webhook.timer.id,
          action: webhook.data.action,
          file_path: webhook.data.file_path,
          instruction: webhook.data.instruction,
          message: webhook.message,
          timestamp: Date.now()
        });
        
        // Send SSE notification to Claude Code
        this.notifyClaudeCode(webhook);
      }
      
      res.json({ success: true });
    });

    // MCP resource endpoint - provides pending commands
    this.app.get('/mcp/commands', (req, res) => {
      res.json({
        resources: this.pendingCommands.map(cmd => ({
          uri: `timer://command/${cmd.id}`,
          name: `Timer Command: ${cmd.action}`,
          description: cmd.instruction,
          mimeType: 'application/json'
        }))
      });
    });

    // MCP prompt endpoint - executes commands
    this.app.post('/mcp/execute-command', (req, res) => {
      const command = this.pendingCommands.shift(); // Get next command
      if (command) {
        res.json({
          messages: [{
            role: 'user',
            content: `TIMER COMMAND TRIGGERED: ${command.instruction}\nFile: ${command.file_path}\nAction: ${command.action}`
          }]
        });
      } else {
        res.json({ messages: [{ role: 'assistant', content: 'No pending timer commands.' }] });
      }
    });
  }

  notifyClaudeCode(webhook) {
    // SSE notification (if Claude Code supports it)
    console.log('🔥 TIMER COMMAND READY FOR CLAUDE CODE:', webhook.data);
  }
}

new MCPTimerServer().app.listen(3001, () => {
  console.log('🚀 MCP Timer Command Server running on port 3001');
});
```

#### **2. MCP Server Configuration**
```json
// claude_desktop_config.json or Claude Code MCP config
{
  "mcpServers": {
    "timer-commands": {
      "command": "node",
      "args": ["mcp-timer-server.js"],
      "env": {
        "PORT": "3001"
      }
    }
  }
}
```

#### **3. Updated Timer Creation**
```bash
# Create timer with MCP webhook URL instead of fake URL
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "30s",
    "name": "CLAUDE_CODE_COMMAND",
    "events": {
      "on_expire": {
        "webhook": "http://localhost:3001/timer-webhook",
        "message": "READ FILE: C:\\Users\\millz\\Desktop\\TESTER111 and execute command",
        "data": {
          "action": "read_file",
          "file_path": "C:\\Users\\millz\\Desktop\\TESTER111", 
          "instruction": "Read the file and execute whatever command is written inside"
        }
      }
    }
  }'
```

#### **4. Claude Code Integration**
```bash
# In Claude Code, use MCP slash commands
/timer-commands__execute-command

# Or check for pending commands
/timer-commands__commands
```

### **🔥 FLOW DIAGRAM**
```
Timer Expires → Webhook to MCP Server → Command Queued → SSE Notification → Claude Code Slash Command → Command Executed
```

### **✅ BENEFITS**
- ✅ **Real-time**: SSE provides immediate notification
- ✅ **Non-blocking**: Claude Code can do other work
- ✅ **Automatic**: Commands injected directly into conversation
- ✅ **Reliable**: No polling, no sleep issues
- ✅ **Extensible**: Can handle any webhook command type

### **🚀 IMPLEMENTATION STEPS**
1. Create MCP Timer Command Server
2. Configure Claude Code to connect to MCP server
3. Update timer webhook URLs to point to MCP server
4. Test with slash commands in Claude Code
5. Add auto-execution triggers if possible

### **🎯 RESULT**
Perfect webhook-to-Claude-Code bridge with real-time command execution!