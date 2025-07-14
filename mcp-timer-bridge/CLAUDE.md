# MCP TIMER COMMAND BRIDGE - CLAUDE.md

## 🎯 SYSTEM PURPOSE
**Premium feature that receives timer webhooks and injects commands into Claude Code sessions.**

## 📁 SYSTEM FILES
- `mcp-timer-server.js` - Main MCP Timer Command Bridge server
- `MCP_TIMER_ARCHITECTURE.md` - Complete technical architecture
- `CLAUDE.md` - This file (system documentation)

## 🚀 WHAT THIS SYSTEM DOES

### **WEBHOOK TO COMMAND BRIDGE**
1. **Receives webhooks** from MINOOTS when timers expire
2. **Queues commands** for Claude Code execution  
3. **Provides MCP interface** for Claude Code to retrieve commands
4. **Executes timer-triggered actions** automatically

### **PREMIUM FEATURE POSITIONING**
- **FREE TIER**: Basic timer creation via standard MCP server (`/mcp/`)
- **PAID TIER**: Automated webhook commands via this Timer Command Bridge
- **VALUE PROP**: Token efficiency + automation for subscription developers

## 🔧 TECHNICAL IMPLEMENTATION

### **SERVER DETAILS**
- **Type**: Express HTTP server
- **Port**: 3001
- **Webhook URL**: `http://localhost:3001/timer-webhook`
- **Health Check**: `http://localhost:3001/health`
- **Debug**: `http://localhost:3001/debug/commands`

### **MCP ENDPOINTS**
- `/mcp/resources/list` - List pending commands as resources
- `/mcp/resources/read` - Get specific command content
- `/mcp/prompts/list` - List available prompt actions
- `/mcp/prompts/get` - Execute prompts (commands)

### **COMMAND FLOW**
```
Timer Expires → MINOOTS calls webhook → Command queued → Claude Code MCP call → Command executed
```

## 🎯 HOW TO USE

### **1. START THE BRIDGE**
```bash
cd /mnt/c/Users/millz/minoots-timer-system
npm run start:mcp  # Starts mcp-timer-bridge/mcp-timer-server.js
```

### **2. CREATE TIMER WITH WEBHOOK**
```bash
curl -X POST https://api-m3waemr5lq-uc.a.run.app/timers \
  -H "Content-Type: application/json" \
  -d '{
    "duration": "30s",
    "name": "CLAUDE_CODE_COMMAND",
    "events": {
      "on_expire": {
        "webhook": "http://localhost:3001/timer-webhook",
        "message": "READ FILE: C:\\path\\to\\file and execute command",
        "data": {
          "action": "read_file",
          "file_path": "C:\\path\\to\\file",
          "instruction": "Read the file and execute whatever command is written inside"
        }
      }
    }
  }'
```

### **3. CLAUDE CODE MCP INTEGRATION**
```bash
# Check for pending commands
curl http://localhost:3001/mcp/prompts/list

# Execute next command
curl -X POST http://localhost:3001/mcp/prompts/get \
  -H "Content-Type: application/json" \
  -d '{"name": "execute-next-command"}'
```

## 🚨 CRITICAL UNKNOWNS TO VERIFY
1. **Can Claude Code connect to custom MCP servers on localhost?**
2. **Can MCP servers inject commands into active Claude Code sessions?**
3. **Are there background/headless Claude Code capabilities?**
4. **How does Claude Code discover and use custom MCP servers?**

## 💰 MONETIZATION NOTES
- High-value feature for subscription users
- Saves tokens by automating timer-triggered tasks  
- Clear differentiation from free timer functionality
- Sticky feature once users rely on automation

## 📋 TESTING STATUS
- ✅ **Server Implementation**: Complete
- ✅ **Webhook Reception**: Working
- ✅ **Command Queuing**: Working
- ✅ **MCP Endpoints**: Implemented
- ❓ **Claude Code Integration**: NEEDS TESTING
- ❓ **End-to-End Flow**: NEEDS VERIFICATION

## 🔗 RELATED SYSTEMS
- **Main MINOOTS API**: `functions/index.js` (timer expiration)
- **System Daemon**: `system-daemon/minoots-timer-daemon.sh` (CRITICAL - executes commands via `claude --resume`)
- **Webhook Bridge**: `webhook-bridge/functions/index.js` (cloud command queue storage)
- **Standard MCP Server**: `/mcp/` (basic timer operations)
- **Project CLAUDE.md**: `/CLAUDE.md` (main project documentation)

---

**READ THIS DOCUMENT BEFORE WORKING ON MCP TIMER BRIDGE SYSTEM**