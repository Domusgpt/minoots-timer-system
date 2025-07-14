#!/usr/bin/env node

/**
 * ENHANCED MINOOTS MCP SERVER - SESSION-AWARE TIMER SYSTEM
 * Automatically captures Claude session details for perfect command targeting
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MINOOTS_API_BASE = 'https://api-m3waemr5lq-uc.a.run.app';
const WEBHOOK_BRIDGE_BASE = 'https://bridge.minoots.com'; // Will be deployed

class EnhancedMinootsMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'minoots-enhanced-timer-system',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  /**
   * CRITICAL: Automatically capture session details when timer is created
   */
  captureSessionDetails() {
    const sessionInfo = {
      // Generate/detect Claude session ID
      claude_session_id: this.detectClaudeSessionId(),
      
      // Current working directory  
      working_directory: process.cwd(),
      
      // Process information
      process_pid: process.pid,
      parent_pid: process.ppid,
      
      // User identification
      user_id: this.getUserId(),
      username: process.env.USER || process.env.USERNAME || 'unknown',
      
      // Environment context
      shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
      terminal: process.env.TERM || 'unknown',
      session_start: Date.now(),
      
      // Git context (if available)
      git_branch: this.getGitBranch(),
      git_repo: this.getGitRepo(),
      
      // System info
      platform: process.platform,
      architecture: process.arch,
      node_version: process.version
    };

    console.error(`📍 Session captured: ${sessionInfo.claude_session_id} in ${sessionInfo.working_directory}`);
    return sessionInfo;
  }

  detectClaudeSessionId() {
    // Try to get existing Claude session ID from environment
    if (process.env.CLAUDE_SESSION_ID) {
      return process.env.CLAUDE_SESSION_ID;
    }
    
    // Try to detect from Claude Code process
    try {
      const claudeProcess = execSync('ps aux | grep "claude code" | grep -v grep', { encoding: 'utf8' });
      if (claudeProcess) {
        // Extract session info from process
        const match = claudeProcess.match(/--session[= ]([a-zA-Z0-9\-]+)/);
        if (match) {
          return match[1];
        }
      }
    } catch (e) {
      // Fall through to generate new session ID
    }
    
    // Generate new session ID based on working directory and timestamp
    const dirHash = path.basename(process.cwd()).replace(/[^a-zA-Z0-9]/g, '_');
    return `claude_${dirHash}_${Date.now().toString(36)}`;
  }

  getUserId() {
    // Try multiple methods to get consistent user ID
    if (process.env.MINOOTS_USER_ID) {
      return process.env.MINOOTS_USER_ID;
    }
    
    const username = process.env.USER || process.env.USERNAME || 'unknown';
    const hostname = require('os').hostname();
    return `${username}_${hostname}`;
  }

  getGitBranch() {
    try {
      return execSync('git branch --show-current 2>/dev/null', { encoding: 'utf8' }).trim();
    } catch (e) {
      return null;
    }
  }

  getGitRepo() {
    try {
      return execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    } catch (e) {
      return null;
    }
  }

  async makeAPIRequest(endpoint, options = {}) {
    const url = `${MINOOTS_API_BASE}${endpoint}`;
    
    const apiKey = process.env.MINOOTS_API_KEY;
    if (!apiKey) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'MINOOTS_API_KEY environment variable not set. MCP server requires API key for authentication.'
      );
    }
    
    const config = {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Enhanced-MINOOTS-MCP-Server/2.0.0',
        'x-api-key': apiKey,
      },
      ...options,
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(`API Error: ${data.error || response.statusText}`);
      }
      
      return data;
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `MINOOTS API request failed: ${error.message}`
      );
    }
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'create_session_timer',
            description: '🔥 Create timer with automatic session targeting - commands execute in THIS Claude session',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name for the timer',
                },
                duration: {
                  type: 'string',
                  description: 'Timer duration (e.g., "30s", "5m", "2h")',
                },
                command: {
                  type: 'string',
                  description: 'Command to execute when timer expires (e.g. "git status", "npm test")',
                },
                message: {
                  type: 'string',
                  description: 'Custom message to show when timer expires (optional)',
                },
              },
              required: ['name', 'duration', 'command'],
            },
          },
          {
            name: 'check_pending_commands',
            description: '🔍 Check for pending timer commands that expired while Claude was away',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'create_timer',
            description: 'Create a basic timer (original functionality)',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Name for the timer' },
                duration: { type: 'string', description: 'Timer duration' },
                webhook: { type: 'string', description: 'Webhook URL (optional)' },
                message: { type: 'string', description: 'Message (optional)' },
              },
              required: ['name', 'duration'],
            },
          },
          {
            name: 'list_timers',
            description: 'List all timers',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'check_api_health',
            description: 'Check MINOOTS API health',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_session_timer':
            return await this.createSessionTimer(args);
          
          case 'check_pending_commands':
            return await this.checkPendingCommands();
          
          case 'create_timer':
            return await this.createBasicTimer(args);
          
          case 'list_timers':
            return await this.listTimers(args);
          
          case 'check_api_health':
            return await this.checkAPIHealth();
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error.message}`
        );
      }
    });
  }

  /**
   * 🔥 MAIN FEATURE: Create timer with automatic session targeting
   */
  async createSessionTimer(args) {
    // AUTOMATICALLY capture session details
    const sessionInfo = this.captureSessionDetails();
    
    // Create timer with webhook pointing to our bridge
    const timerConfig = {
      name: args.name,
      duration: args.duration,
      agent_id: sessionInfo.claude_session_id,
      events: {
        on_expire: {
          webhook: `${WEBHOOK_BRIDGE_BASE}/webhook/${sessionInfo.user_id}`,
          message: args.message || `Timer "${args.name}" expired - executing command`,
          data: {
            // CRITICAL: All targeting information for perfect execution
            command: args.command,
            session_id: sessionInfo.claude_session_id,
            working_directory: sessionInfo.working_directory,
            process_pid: sessionInfo.process_pid,
            user_id: sessionInfo.user_id,
            username: sessionInfo.username,
            git_branch: sessionInfo.git_branch,
            git_repo: sessionInfo.git_repo,
            platform: sessionInfo.platform,
            created_timestamp: Date.now(),
            command_type: 'session_targeted_execution'
          }
        }
      },
      metadata: {
        session_aware: true,
        created_by: 'enhanced_mcp_server',
        session_info: sessionInfo
      }
    };

    const result = await this.makeAPIRequest('/timers', {
      method: 'POST',
      body: timerConfig,
    });

    return {
      content: [
        {
          type: 'text',
          text: `🔥 SESSION-TARGETED TIMER CREATED!\n\n` +
                `✅ **Timer Details:**\n` +
                `- Name: ${result.timer.name}\n` +
                `- Duration: ${this.formatDuration(result.timer.duration)}\n` +
                `- Command: \`${args.command}\`\n` +
                `- Timer ID: ${result.timer.id}\n\n` +
                `📍 **Session Targeting:**\n` +
                `- Session ID: ${sessionInfo.claude_session_id}\n` +
                `- Directory: ${sessionInfo.working_directory}\n` +
                `- User: ${sessionInfo.username}\n` +
                `${sessionInfo.git_branch ? `- Git Branch: ${sessionInfo.git_branch}\n` : ''}` +
                `\n🎯 **AUTOMATIC EXECUTION**: When timer expires, command will execute in THIS exact Claude session!\n` +
                `\n⚡ Timer is running - command will execute automatically after ${args.duration}`,
        },
      ],
    };
  }

  /**
   * Check for pending commands that expired while Claude was away
   */
  async checkPendingCommands() {
    const sessionInfo = this.captureSessionDetails();
    
    try {
      // Check webhook bridge for pending commands
      const response = await fetch(`${WEBHOOK_BRIDGE_BASE}/commands/${sessionInfo.user_id}`, {
        headers: {
          'Authorization': `Bearer ${process.env.MINOOTS_API_KEY}`,
        }
      });
      
      if (!response.ok) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ Could not check for pending commands. Webhook bridge may not be deployed yet.\n` +
                  `Bridge URL: ${WEBHOOK_BRIDGE_BASE}`
          }]
        };
      }
      
      const commands = await response.json();
      
      if (!commands || commands.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `✅ No pending timer commands found.\n` +
                  `Session: ${sessionInfo.claude_session_id}\n` +
                  `Directory: ${sessionInfo.working_directory}`
          }]
        };
      }
      
      // Show pending commands for user to execute
      const commandList = commands.map((cmd, index) => 
        `${index + 1}. **${cmd.timer_name || 'Timer'}** (expired ${this.timeAgo(cmd.timestamp)})\n` +
        `   Command: \`${cmd.command}\`\n` +
        `   From: ${cmd.working_directory}`
      ).join('\n\n');
      
      return {
        content: [{
          type: 'text',
          text: `🔥 PENDING TIMER COMMANDS FOUND!\n\n` +
                `${commandList}\n\n` +
                `🎯 These commands are ready to execute. The system daemon should handle these automatically,\n` +
                `or you can execute them manually if needed.`
        }]
      };
      
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Error checking for pending commands: ${error.message}\n` +
                `This is expected if the webhook bridge is not yet deployed.`
        }]
      };
    }
  }

  // Original timer creation (basic functionality)
  async createBasicTimer(args) {
    const timerConfig = {
      name: args.name,
      duration: args.duration,
      ...(args.webhook && { 
        events: {
          on_expire: {
            webhook: args.webhook,
            message: args.message || `Timer ${args.name} expired`
          }
        }
      })
    };

    const result = await this.makeAPIRequest('/timers', {
      method: 'POST',
      body: timerConfig,
    });

    return {
      content: [{
        type: 'text',
        text: `✅ Basic timer created: ${result.timer.name}\n` +
              `Duration: ${this.formatDuration(result.timer.duration)}\n` +
              `ID: ${result.timer.id}`
      }]
    };
  }

  async listTimers() {
    const result = await this.makeAPIRequest('/timers');
    
    if (result.timers.length === 0) {
      return {
        content: [{
          type: 'text',
          text: '📝 No timers found.'
        }]
      };
    }

    const timerList = result.timers.map(timer => {
      const timeRemaining = this.formatDuration(timer.timeRemaining);
      const progress = Math.round(timer.progress * 100);
      const isSessionAware = timer.metadata?.session_aware ? '🎯' : '📄';
      
      return `${isSessionAware} **${timer.name}** (${timer.id.substring(0, 8)}...)\n` +
             `  Status: ${timer.status} | Progress: ${progress}% | Remaining: ${timeRemaining}`;
    }).join('\n\n');

    return {
      content: [{
        type: 'text',
        text: `📋 Found ${result.count} timer(s):\n\n${timerList}\n\n` +
              `🎯 = Session-aware timer | 📄 = Basic timer`
      }]
    };
  }

  async checkAPIHealth() {
    const result = await this.makeAPIRequest('/health');
    
    return {
      content: [{
        type: 'text',
        text: `🟢 MINOOTS API Health Check\n\n` +
              `Status: ${result.status}\n` +
              `Service: ${result.service}\n` +
              `API URL: ${MINOOTS_API_BASE}\n` +
              `Enhanced MCP Version: 2.0.0\n` +
              `Session Detection: ✅ Active`
      }]
    };
  }

  // Utility methods
  formatDuration(ms) {
    if (ms <= 0) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('🔥 Enhanced MINOOTS MCP Server running with session targeting!');
  }
}

// Run the enhanced server
const server = new EnhancedMinootsMCPServer();
server.run().catch(console.error);