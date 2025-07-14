#!/usr/bin/env node

/**
 * MCP Timer Command Server
 * Receives timer webhooks and provides commands to Claude Code via MCP
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

class MCPTimerServer {
    constructor() {
        this.pendingCommands = [];
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.raw({ type: 'application/json' }));
        
        // CORS for local development
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                service: 'MCP Timer Command Server',
                pendingCommands: this.pendingCommands.length,
                timestamp: new Date().toISOString()
            });
        });

        // Receive timer webhooks from MINOOTS
        this.app.post('/timer-webhook', (req, res) => {
            console.log('🔔 Received timer webhook:', JSON.stringify(req.body, null, 2));
            
            try {
                const webhook = req.body;
                
                // Check if it's a Claude Code command
                if (webhook.data?.action === 'read_file') {
                    const command = {
                        id: uuidv4(),
                        timerId: webhook.timer?.id || 'unknown',
                        action: webhook.data.action,
                        file_path: webhook.data.file_path,
                        instruction: webhook.data.instruction || webhook.message,
                        message: webhook.message,
                        timestamp: new Date().toISOString(),
                        executed: false
                    };
                    
                    this.pendingCommands.push(command);
                    
                    console.log('🚀 CLAUDE CODE COMMAND QUEUED:', command);
                    console.log(`📋 Total pending commands: ${this.pendingCommands.length}`);
                    
                    res.json({ 
                        success: true, 
                        commandId: command.id,
                        message: 'Claude Code command queued successfully'
                    });
                } else {
                    console.log('ℹ️  Non-Claude-Code webhook received');
                    res.json({ 
                        success: true, 
                        message: 'Webhook received but not a Claude Code command'
                    });
                }
            } catch (error) {
                console.error('❌ Error processing webhook:', error);
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        // MCP: List available resources (pending commands)
        this.app.get('/mcp/resources/list', (req, res) => {
            const resources = this.pendingCommands
                .filter(cmd => !cmd.executed)
                .map(cmd => ({
                    uri: `timer://command/${cmd.id}`,
                    name: `Timer Command: ${cmd.action}`,
                    description: `${cmd.instruction} (File: ${cmd.file_path})`,
                    mimeType: 'application/json'
                }));

            res.json({ resources });
        });

        // MCP: Get specific resource content
        this.app.get('/mcp/resources/read', (req, res) => {
            const uri = req.query.uri;
            const commandId = uri?.split('/').pop();
            
            const command = this.pendingCommands.find(cmd => cmd.id === commandId);
            
            if (command) {
                res.json({
                    contents: [{
                        uri: uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(command, null, 2)
                    }]
                });
            } else {
                res.status(404).json({ error: 'Command not found' });
            }
        });

        // MCP: List available prompts
        this.app.get('/mcp/prompts/list', (req, res) => {
            res.json({
                prompts: [
                    {
                        name: 'execute-next-command',
                        description: 'Execute the next pending timer command',
                        arguments: []
                    },
                    {
                        name: 'list-pending-commands',
                        description: 'List all pending timer commands',
                        arguments: []
                    },
                    {
                        name: 'execute-command',
                        description: 'Execute a specific timer command by ID',
                        arguments: [
                            {
                                name: 'commandId',
                                description: 'The ID of the command to execute',
                                required: true
                            }
                        ]
                    }
                ]
            });
        });

        // MCP: Execute prompts
        this.app.post('/mcp/prompts/get', (req, res) => {
            const { name, arguments: args } = req.body;
            
            switch (name) {
                case 'execute-next-command':
                    const nextCommand = this.pendingCommands.find(cmd => !cmd.executed);
                    if (nextCommand) {
                        nextCommand.executed = true;
                        nextCommand.executedAt = new Date().toISOString();
                        
                        res.json({
                            messages: [{
                                role: 'user',
                                content: `🔥 TIMER COMMAND TRIGGERED!\n\n` +
                                        `**Instruction**: ${nextCommand.instruction}\n` +
                                        `**File Path**: ${nextCommand.file_path}\n` +
                                        `**Action**: ${nextCommand.action}\n` +
                                        `**Timer ID**: ${nextCommand.timerId}\n\n` +
                                        `Please execute this command now.`
                            }]
                        });
                        
                        console.log('✅ Command executed via MCP:', nextCommand.id);
                    } else {
                        res.json({
                            messages: [{
                                role: 'assistant',
                                content: 'No pending timer commands to execute.'
                            }]
                        });
                    }
                    break;
                
                case 'list-pending-commands':
                    const pending = this.pendingCommands.filter(cmd => !cmd.executed);
                    res.json({
                        messages: [{
                            role: 'assistant',
                            content: `📋 Pending Timer Commands (${pending.length}):\n\n` +
                                    pending.map((cmd, i) => 
                                        `${i + 1}. **${cmd.action}**: ${cmd.instruction}\n` +
                                        `   File: ${cmd.file_path}\n` +
                                        `   Time: ${cmd.timestamp}\n`
                                    ).join('\n')
                        }]
                    });
                    break;
                
                case 'execute-command':
                    const commandId = args?.commandId;
                    const specificCommand = this.pendingCommands.find(cmd => cmd.id === commandId && !cmd.executed);
                    
                    if (specificCommand) {
                        specificCommand.executed = true;
                        specificCommand.executedAt = new Date().toISOString();
                        
                        res.json({
                            messages: [{
                                role: 'user',
                                content: `🔥 SPECIFIC TIMER COMMAND TRIGGERED!\n\n` +
                                        `**Instruction**: ${specificCommand.instruction}\n` +
                                        `**File Path**: ${specificCommand.file_path}\n` +
                                        `**Action**: ${specificCommand.action}\n\n` +
                                        `Please execute this command now.`
                            }]
                        });
                    } else {
                        res.json({
                            messages: [{
                                role: 'assistant', 
                                content: `Command with ID ${commandId} not found or already executed.`
                            }]
                        });
                    }
                    break;
                
                default:
                    res.status(400).json({ error: 'Unknown prompt name' });
            }
        });

        // Daemon endpoint - get commands for specific user
        this.app.get('/commands/:userId', (req, res) => {
            const userId = req.params.userId;
            console.log(`📋 Daemon requesting commands for user: ${userId}`);
            
            // For now, return all pending commands regardless of user
            // In production, this would filter by userId
            const pendingCommands = this.pendingCommands
                .filter(cmd => !cmd.executed)
                .map(cmd => ({
                    id: cmd.id,
                    command: cmd.instruction, // Map instruction to command
                    session_id: cmd.session_id || null,
                    working_directory: cmd.working_directory || ".",
                    timer_name: cmd.timerId,
                    username: userId
                }));
            
            res.json(pendingCommands);
        });

        // Daemon endpoint - mark command as executed
        this.app.post('/markExecuted', (req, res) => {
            const { commandId } = req.body;
            console.log(`✅ Marking command ${commandId} as executed`);
            
            const command = this.pendingCommands.find(cmd => cmd.id === commandId);
            if (command) {
                command.executed = true;
                command.executedAt = new Date().toISOString();
                console.log(`✅ Command ${commandId} successfully marked as executed`);
            } else {
                console.log(`⚠️ Command ${commandId} not found for execution marking`);
            }
            
            res.json({ success: true });
        });

        // Debug endpoint to see all commands
        this.app.get('/debug/commands', (req, res) => {
            res.json({
                pendingCommands: this.pendingCommands,
                stats: {
                    total: this.pendingCommands.length,
                    pending: this.pendingCommands.filter(cmd => !cmd.executed).length,
                    executed: this.pendingCommands.filter(cmd => cmd.executed).length
                }
            });
        });
    }

    start(port = 3001) {
        this.app.listen(port, () => {
            console.log('🚀 MCP Timer Command Server started!');
            console.log(`📡 Webhook endpoint: http://localhost:${port}/timer-webhook`);
            console.log(`🔧 Debug endpoint: http://localhost:${port}/debug/commands`);
            console.log(`💡 Health check: http://localhost:${port}/health`);
            console.log('\n🎯 Ready to receive timer webhooks and serve Claude Code commands!');
        });
    }
}

// Start the server
if (require.main === module) {
    const server = new MCPTimerServer();
    server.start();
}

module.exports = MCPTimerServer;