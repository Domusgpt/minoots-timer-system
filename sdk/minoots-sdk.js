/**
 * MINOOTS Node.js SDK
 * Independent Timer System for Autonomous Agents & Enterprise Workflows
 * 
 * Official SDK for interacting with MINOOTS API
 * Base URL: https://api-m3waemr5lq-uc.a.run.app
 */

class MinootsSDK {
    constructor(options = {}) {
        this.baseURL = options.baseURL || 'https://api-m3waemr5lq-uc.a.run.app';
        this.defaultAgentId = options.agentId || 'sdk_agent';
        this.defaultTeam = options.team;
        this.timeout = options.timeout || 10000;
    }

    // Internal HTTP client
    async _request(method, endpoint, data = null) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (data) {
            config.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, config);
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(`API Error (${response.status}): ${result.error || response.statusText}`);
            }
            
            return result;
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error(`Network error: Unable to connect to MINOOTS API at ${url}`);
            }
            throw error;
        }
    }

    // Health check
    async health() {
        return await this._request('GET', '/health');
    }

    // Timer Management
    async createTimer(config) {
        const timerConfig = {
            name: config.name,
            duration: config.duration,
            agent_id: config.agentId || this.defaultAgentId,
            ...config
        };

        if (this.defaultTeam && !timerConfig.team) {
            timerConfig.team = this.defaultTeam;
        }

        return await this._request('POST', '/timers', timerConfig);
    }

    async getTimer(timerId) {
        return await this._request('GET', `/timers/${timerId}`);
    }

    async listTimers(filters = {}) {
        const queryParams = new URLSearchParams();
        
        if (filters.agentId) queryParams.append('agent_id', filters.agentId);
        if (filters.team) queryParams.append('team', filters.team);
        if (filters.status) queryParams.append('status', filters.status);

        const endpoint = queryParams.toString() ? `/timers?${queryParams}` : '/timers';
        return await this._request('GET', endpoint);
    }

    async deleteTimer(timerId) {
        return await this._request('DELETE', `/timers/${timerId}`);
    }

    // Quick timer creation
    async quickWait(duration, options = {}) {
        const config = {
            duration,
            name: options.name || `quick_wait_${Date.now()}`,
            agent_id: options.agentId || this.defaultAgentId,
            ...options
        };

        return await this._request('POST', '/quick/wait', config);
    }

    // Team communication
    async broadcastToTeam(teamName, message, data = {}) {
        return await this._request('POST', `/teams/${teamName}/broadcast`, {
            message,
            data
        });
    }

    // Utility methods
    parseDuration(duration) {
        if (typeof duration === 'number') return duration;
        const units = { 'ms': 1, 's': 1000, 'm': 60000, 'h': 3600000, 'd': 86400000 };
        const match = duration.toString().match(/^(\d+)([a-z]+)$/i);
        if (!match) throw new Error(`Invalid duration: ${duration}`);
        const [, value, unit] = match;
        const multiplier = units[unit.toLowerCase()];
        if (!multiplier) throw new Error(`Unknown unit: ${unit}`);
        return parseInt(value) * multiplier;
    }

    formatTimeRemaining(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
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

    // Advanced timer methods
    async createTimerWithWebhook(config) {
        return await this.createTimer({
            ...config,
            events: {
                on_expire: {
                    message: config.message || `Timer ${config.name} expired`,
                    webhook: config.webhook,
                    data: config.data || {}
                }
            }
        });
    }

    async createRecurringCheck(name, interval, webhook) {
        return await this.createTimer({
            name,
            duration: interval,
            events: {
                on_expire: {
                    message: `Recurring check: ${name}`,
                    webhook,
                    data: { type: 'recurring_check', interval }
                }
            }
        });
    }

    // Agent coordination methods
    async waitFor(duration, agentId = null) {
        const timer = await this.quickWait(duration, {
            agentId: agentId || this.defaultAgentId,
            name: `wait_${agentId || this.defaultAgentId}_${Date.now()}`
        });

        // Return a promise that resolves when the timer expires
        return new Promise((resolve) => {
            const durationMs = this.parseDuration(duration);
            setTimeout(() => {
                resolve(timer);
            }, durationMs);
        });
    }

    async pollTimer(timerId, intervalMs = 1000) {
        return new Promise((resolve, reject) => {
            const poll = async () => {
                try {
                    const result = await this.getTimer(timerId);
                    if (!result.success) {
                        reject(new Error(result.error));
                        return;
                    }

                    const timer = result.timer;
                    
                    // Check if timer is expired or completed
                    if (timer.status === 'expired' || timer.timeRemaining <= 0) {
                        resolve(timer);
                        return;
                    }

                    // Continue polling
                    setTimeout(poll, intervalMs);
                } catch (error) {
                    reject(error);
                }
            };

            poll();
        });
    }

    async streamTimers(options = {}) {
        const params = new URLSearchParams();
        if (options.tenantId) {
            params.set('tenantId', options.tenantId);
        }

        const url = `${this.baseURL}/timers/stream${params.toString() ? `?${params}` : ''}`;
        const controller = new AbortController();
        const signal = options.signal ?? controller.signal;
        const response = await fetch(url, {
            headers: { Accept: 'text/event-stream' },
            signal,
        });

        if (!response.ok || !response.body) {
            throw new Error(`Failed to open timer stream: ${response.status} ${response.statusText}`);
        }

        const handlers = [];
        if (typeof options.onEvent === 'function') {
            handlers.push(options.onEvent);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        const invokeHandlers = (event) => {
            handlers.forEach((handler) => {
                try {
                    handler(event);
                } catch (error) {
                    console.error('Timer stream handler failed', error);
                }
            });
        };

        const parseEventChunk = (chunk) => {
            const lines = chunk.split(/\r?\n/);
            let eventType = 'message';
            let dataLines = [];
            for (const line of lines) {
                if (line.startsWith('event:')) {
                    eventType = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).trim());
                }
            }
            if (dataLines.length === 0) {
                return null;
            }
            const payload = dataLines.join('\n');
            try {
                return { type: eventType, data: JSON.parse(payload) };
            } catch (error) {
                return { type: eventType, data: payload };
            }
        };

        (async () => {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    let boundary = buffer.indexOf('\n\n');
                    while (boundary !== -1) {
                        const chunk = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);
                        const event = parseEventChunk(chunk);
                        if (event) {
                            invokeHandlers(event);
                        }
                        boundary = buffer.indexOf('\n\n');
                    }
                }
            } catch (error) {
                if (signal.aborted) {
                    return;
                }
                console.error('Timer event stream failed', error);
            }
        })();

        return {
            close: () => controller.abort(),
            onEvent: (handler) => {
                if (typeof handler === 'function') {
                    handlers.push(handler);
                }
            },
        };
    }
}

// Export for CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MinootsSDK;
} else if (typeof exports !== 'undefined') {
    exports.MinootsSDK = MinootsSDK;
}

// Export for ES modules
if (typeof window === 'undefined') {
    global.MinootsSDK = MinootsSDK;
}