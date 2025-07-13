#!/usr/bin/env node

/**
 * MINOOTS MCP Server
 * Model Context Protocol server for MINOOTS Independent Timer System
 * Enables Claude agents to create, monitor, and coordinate timers
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

const MINOOTS_API_BASE = 'https://api-m3waemr5lq-uc.a.run.app';

class MinootsMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'minoots-timer-system',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  async makeAPIRequest(endpoint, options = {}) {
    const url = `${MINOOTS_API_BASE}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MINOOTS-MCP-Server/1.0.0',
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
            name: 'create_timer',
            description: 'Create a new timer with optional webhook notifications',
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
                agent_id: {
                  type: 'string',
                  description: 'ID of the agent creating the timer',
                },
                team: {
                  type: 'string',
                  description: 'Team name for coordination (optional)',
                },
                webhook: {
                  type: 'string',
                  description: 'Webhook URL to call when timer expires (optional)',
                },
                message: {
                  type: 'string',
                  description: 'Message to send when timer expires (optional)',
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata for the timer (optional)',
                },
              },
              required: ['name', 'duration'],
            },
          },
          {
            name: 'get_timer',
            description: 'Get details and current status of a specific timer',
            inputSchema: {
              type: 'object',
              properties: {
                timer_id: {
                  type: 'string',
                  description: 'ID of the timer to retrieve',
                },
              },
              required: ['timer_id'],
            },
          },
          {
            name: 'list_timers',
            description: 'List all timers with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: {
                  type: 'string',
                  description: 'Filter by agent ID (optional)',
                },
                team: {
                  type: 'string',
                  description: 'Filter by team name (optional)',
                },
                status: {
                  type: 'string',
                  description: 'Filter by status: running, expired (optional)',
                },
              },
            },
          },
          {
            name: 'delete_timer',
            description: 'Delete a specific timer',
            inputSchema: {
              type: 'object',
              properties: {
                timer_id: {
                  type: 'string',
                  description: 'ID of the timer to delete',
                },
              },
              required: ['timer_id'],
            },
          },
          {
            name: 'quick_wait',
            description: 'Create a simple wait timer for agent coordination',
            inputSchema: {
              type: 'object',
              properties: {
                duration: {
                  type: 'string',
                  description: 'Wait duration (e.g., "30s", "5m")',
                },
                name: {
                  type: 'string',
                  description: 'Optional name for the wait timer',
                },
                agent_id: {
                  type: 'string',
                  description: 'ID of the waiting agent',
                },
              },
              required: ['duration'],
            },
          },
          {
            name: 'broadcast_to_team',
            description: 'Send a message to all agents in a team',
            inputSchema: {
              type: 'object',
              properties: {
                team: {
                  type: 'string',
                  description: 'Team name to broadcast to',
                },
                message: {
                  type: 'string',
                  description: 'Message to broadcast',
                },
                data: {
                  type: 'object',
                  description: 'Additional data to include (optional)',
                },
              },
              required: ['team', 'message'],
            },
          },
          {
            name: 'agent_coordination_session',
            description: 'Create a coordination session for multiple agents',
            inputSchema: {
              type: 'object',
              properties: {
                session_name: {
                  type: 'string',
                  description: 'Name for the coordination session',
                },
                agents: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of agent IDs to coordinate',
                },
                workflow: {
                  type: 'object',
                  description: 'Workflow definition with steps and timings',
                },
              },
              required: ['session_name', 'agents'],
            },
          },
          {
            name: 'check_api_health',
            description: 'Check if MINOOTS API is responding',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_timer':
            return await this.createTimer(args);
          
          case 'get_timer':
            return await this.getTimer(args);
          
          case 'list_timers':
            return await this.listTimers(args);
          
          case 'delete_timer':
            return await this.deleteTimer(args);
          
          case 'quick_wait':
            return await this.quickWait(args);
          
          case 'broadcast_to_team':
            return await this.broadcastToTeam(args);
          
          case 'agent_coordination_session':
            return await this.createCoordinationSession(args);
          
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

  async createTimer(args) {
    const timerConfig = {
      name: args.name,
      duration: args.duration,
      agent_id: args.agent_id || 'mcp_agent',
      ...args,
    };

    // Add webhook configuration if provided
    if (args.webhook || args.message) {
      timerConfig.events = {
        on_expire: {
          message: args.message || `Timer ${args.name} expired`,
          ...(args.webhook && { webhook: args.webhook }),
        },
      };
    }

    const result = await this.makeAPIRequest('/timers', {
      method: 'POST',
      body: timerConfig,
    });

    return {
      content: [
        {
          type: 'text',
          text: `✅ Timer created successfully!\n\n` +
                `**Timer Details:**\n` +
                `- ID: ${result.timer.id}\n` +
                `- Name: ${result.timer.name}\n` +
                `- Duration: ${this.formatDuration(result.timer.duration)}\n` +
                `- Status: ${result.timer.status}\n` +
                `- Agent: ${result.timer.agentId || 'N/A'}\n` +
                `${result.timer.team ? `- Team: ${result.timer.team}\n` : ''}` +
                `\n🕐 Timer is now running and will expire automatically.`,
        },
      ],
    };
  }

  async getTimer(args) {
    const result = await this.makeAPIRequest(`/timers/${args.timer_id}`);
    const timer = result.timer;

    const timeRemaining = this.formatDuration(timer.timeRemaining);
    const progress = Math.round(timer.progress * 100);

    return {
      content: [
        {
          type: 'text',
          text: `📊 Timer Status: ${timer.name}\n\n` +
                `**Current State:**\n` +
                `- ID: ${timer.id}\n` +
                `- Status: ${timer.status}\n` +
                `- Progress: ${progress}%\n` +
                `- Time Remaining: ${timeRemaining}\n` +
                `- Agent: ${timer.agentId || 'N/A'}\n` +
                `${timer.team ? `- Team: ${timer.team}\n` : ''}` +
                `\n${this.getProgressBar(timer.progress)}`,
        },
      ],
    };
  }

  async listTimers(args = {}) {
    const queryParams = new URLSearchParams();
    if (args.agent_id) queryParams.append('agent_id', args.agent_id);
    if (args.team) queryParams.append('team', args.team);
    if (args.status) queryParams.append('status', args.status);

    const endpoint = queryParams.toString() ? `/timers?${queryParams}` : '/timers';
    const result = await this.makeAPIRequest(endpoint);

    if (result.timers.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: '📝 No timers found matching the criteria.',
          },
        ],
      };
    }

    const timerList = result.timers.map(timer => {
      const timeRemaining = this.formatDuration(timer.timeRemaining);
      const progress = Math.round(timer.progress * 100);
      
      return `• **${timer.name}** (${timer.id.substring(0, 8)}...)\n` +
             `  Status: ${timer.status} | Progress: ${progress}% | Remaining: ${timeRemaining}`;
    }).join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `📋 Found ${result.count} timer(s):\n\n${timerList}`,
        },
      ],
    };
  }

  async deleteTimer(args) {
    await this.makeAPIRequest(`/timers/${args.timer_id}`, {
      method: 'DELETE',
    });

    return {
      content: [
        {
          type: 'text',
          text: `🗑️ Timer ${args.timer_id} has been deleted successfully.`,
        },
      ],
    };
  }

  async quickWait(args) {
    const waitConfig = {
      duration: args.duration,
      name: args.name || `quick_wait_${Date.now()}`,
      agent_id: args.agent_id || 'mcp_agent',
    };

    const result = await this.makeAPIRequest('/quick/wait', {
      method: 'POST',
      body: waitConfig,
    });

    return {
      content: [
        {
          type: 'text',
          text: `⏳ Quick wait timer created!\n\n` +
                `**Wait Details:**\n` +
                `- Duration: ${args.duration}\n` +
                `- Timer ID: ${result.timer.id}\n` +
                `- Agent: ${args.agent_id || 'mcp_agent'}\n` +
                `\n⌛ Agent will wait for ${args.duration} before continuing.`,
        },
      ],
    };
  }

  async broadcastToTeam(args) {
    const result = await this.makeAPIRequest(`/teams/${args.team}/broadcast`, {
      method: 'POST',
      body: {
        message: args.message,
        data: args.data || {},
      },
    });

    return {
      content: [
        {
          type: 'text',
          text: `📢 Message broadcast to team "${args.team}":\n\n` +
                `**Message:** ${args.message}\n` +
                `**Timestamp:** ${new Date(result.broadcast.timestamp).toISOString()}\n` +
                `\n✅ All team members have been notified.`,
        },
      ],
    };
  }

  async createCoordinationSession(args) {
    // This is an advanced feature that creates multiple coordinated timers
    const sessionId = `session_${Date.now()}`;
    const timers = [];

    // Create a coordination timer for each agent
    for (const agentId of args.agents) {
      const timer = await this.makeAPIRequest('/timers', {
        method: 'POST',
        body: {
          name: `${args.session_name}_${agentId}`,
          duration: '1m', // Default coordination window
          agent_id: agentId,
          team: args.session_name,
          metadata: {
            session_id: sessionId,
            coordination_session: true,
            workflow: args.workflow,
          },
        },
      });
      timers.push(timer.timer);
    }

    return {
      content: [
        {
          type: 'text',
          text: `🤝 Coordination session "${args.session_name}" created!\n\n` +
                `**Session ID:** ${sessionId}\n` +
                `**Participating Agents:** ${args.agents.join(', ')}\n` +
                `**Timers Created:** ${timers.length}\n` +
                `\n🎯 All agents are now synchronized for coordinated work.`,
        },
      ],
    };
  }

  async checkAPIHealth() {
    const result = await this.makeAPIRequest('/health');
    
    return {
      content: [
        {
          type: 'text',
          text: `🟢 MINOOTS API Health Check\n\n` +
                `**Status:** ${result.status}\n` +
                `**Service:** ${result.service}\n` +
                `**Timestamp:** ${new Date(result.timestamp).toISOString()}\n` +
                `**API URL:** ${MINOOTS_API_BASE}\n` +
                `\n✅ API is responding normally.`,
        },
      ],
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

  getProgressBar(progress) {
    const width = 20;
    const filled = Math.floor(progress * width);
    const empty = width - filled;
    
    return `[${('█').repeat(filled)}${('░').repeat(empty)}] ${Math.round(progress * 100)}%`;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MINOOTS MCP Server running on stdio');
  }
}

// Run the server
const server = new MinootsMCPServer();
server.run().catch(console.error);