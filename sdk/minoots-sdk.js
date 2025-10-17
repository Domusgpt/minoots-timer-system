'use strict';

const DEFAULT_BASE_URL = 'https://api-m3waemr5lq-uc.a.run.app';
const DEFAULT_TIMEOUT = 10000;

class MinootsError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'MinootsError';
    }
}

class MinootsTimeoutError extends MinootsError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'MinootsTimeoutError';
    }
}

class MinootsAPIError extends MinootsError {
    constructor(message, status, details, options = {}) {
        super(message, options);
        this.name = 'MinootsAPIError';
        this.status = status;
        this.details = details;
    }
}

class MinootsSDK {
    constructor(options = {}) {
        this.baseURL = options.baseURL || DEFAULT_BASE_URL;
        this.defaultAgentId = options.agentId || 'sdk_agent';
        this.defaultTeam = options.team;
        this.apiKey = options.apiKey || null;
        this.timeout = typeof options.timeout === 'number' ? options.timeout : DEFAULT_TIMEOUT;
        this.userAgent = options.userAgent || 'MinootsSDK/1.0.0';

        const retry = options.retry || {};
        this.retryConfig = {
            attempts: typeof retry.attempts === 'number' ? Math.max(0, retry.attempts) : 0,
            minTimeout: typeof retry.minTimeout === 'number' ? Math.max(0, retry.minTimeout) : 250,
            maxTimeout: typeof retry.maxTimeout === 'number' ? Math.max(1, retry.maxTimeout) : 5000,
            factor: typeof retry.factor === 'number' && retry.factor > 1 ? retry.factor : 2,
            jitter: retry.jitter !== false,
            retryOn: Array.isArray(retry.retryOn) ? retry.retryOn.slice() : [408, 409, 425, 429, 500, 502, 503, 504],
            shouldRetry: typeof retry.shouldRetry === 'function' ? retry.shouldRetry : null,
        };

        const hooks = options.hooks || {};
        this.hooks = {
            beforeRequest: Array.isArray(hooks.beforeRequest) ? hooks.beforeRequest.slice() : [],
            afterResponse: Array.isArray(hooks.afterResponse) ? hooks.afterResponse.slice() : [],
            onRetry: Array.isArray(hooks.onRetry) ? hooks.onRetry.slice() : [],
        };

        const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        if (!fetchImpl) {
            throw new MinootsError('Fetch API is not available in this environment. Provide a custom implementation via options.fetch.');
        }
        this.fetchImpl = fetchImpl;
    }

    _snapshotOptions() {
        return {
            baseURL: this.baseURL,
            agentId: this.defaultAgentId,
            team: this.defaultTeam,
            apiKey: this.apiKey,
            timeout: this.timeout,
            userAgent: this.userAgent,
            fetch: this.fetchImpl,
            retry: { ...this.retryConfig },
            hooks: {
                beforeRequest: this.hooks.beforeRequest.slice(),
                afterResponse: this.hooks.afterResponse.slice(),
                onRetry: this.hooks.onRetry.slice(),
            },
        };
    }

    withDefaults(overrides = {}) {
        return new MinootsSDK({ ...this._snapshotOptions(), ...overrides });
    }

    withApiKey(apiKey) {
        return this.withDefaults({ apiKey });
    }

    setApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    withAgent(agentId) {
        return this.withDefaults({ agentId });
    }

    setAgent(agentId) {
        this.defaultAgentId = agentId;
    }

    withTeam(team) {
        return this.withDefaults({ team });
    }

    setTeam(team) {
        this.defaultTeam = team;
    }

    withRetry(retryOptions = {}) {
        return this.withDefaults({ retry: { ...this.retryConfig, ...retryOptions } });
    }

    setRetry(retryOptions = {}) {
        this.retryConfig = { ...this.retryConfig, ...retryOptions };
    }

    _buildHeaders(extra = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
        };

        if (this.apiKey) {
            headers['x-api-key'] = this.apiKey;
        }

        return { ...headers, ...extra };
    }

    _createURL(endpoint, query) {
        const url = new URL(endpoint, this.baseURL);
        if (query && typeof query === 'object') {
            Object.entries(query).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    url.searchParams.append(key, String(value));
                }
            });
        }
        return url;
    }

    _createTimeoutController(timeoutOverride) {
        const timeout = typeof timeoutOverride === 'number' ? timeoutOverride : this.timeout;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId, timeout };
    }

    async _parseResponse(response) {
        const contentType = response.headers && response.headers.get ? response.headers.get('content-type') : null;
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (error) {
            return text;
        }
    }

    async _request(method, endpoint, { body, query, headers, timeout } = {}) {
        const url = this._createURL(endpoint, query);
        const baseConfig = {
            method,
            headers: this._buildHeaders(headers),
        };
        if (body !== undefined && body !== null) {
            baseConfig.body = JSON.stringify(body);
        }

        const attempts = Math.max(0, this.retryConfig.attempts);
        let attempt = 0;
        let lastError;

        while (attempt <= attempts) {
            const { controller, timeoutId, timeout: resolvedTimeout } = this._createTimeoutController(timeout);
            const requestConfig = { ...baseConfig, signal: controller.signal };
            try {
                await this._runHooks('beforeRequest', { url, requestConfig, attempt });
                const response = await this.fetchImpl(url.toString(), requestConfig);
                await this._runHooks('afterResponse', { url, requestConfig, response, attempt });
                const payload = await this._parseResponse(response);

                if (!response.ok) {
                    const message = payload && payload.error ? payload.error : `API Error (${response.status})`;
                    throw new MinootsAPIError(message, response.status, payload);
                }

                clearTimeout(timeoutId);
                return payload;
            } catch (error) {
                lastError = error;
                if (error && error.name === 'AbortError') {
                    clearTimeout(timeoutId);
                    throw new MinootsTimeoutError(`Request to ${url.pathname} timed out after ${resolvedTimeout}ms`, { cause: error });
                }

                if (!(error instanceof MinootsError)) {
                    lastError = new MinootsError(error.message || 'Unknown error', { cause: error });
                }

                const shouldRetry = this._shouldRetry(lastError, attempt);
                if (!shouldRetry || attempt === attempts) {
                    clearTimeout(timeoutId);
                    throw lastError;
                }

                await this._runHooks('onRetry', { url, requestConfig, attempt, error: lastError });
                const delay = this._computeRetryDelay(attempt);
                await this._delay(delay);
            }

            attempt += 1;
        }

        throw lastError || new MinootsError('Unknown request failure');
    }

    async health() {
        return await this._request('GET', '/health');
    }

    _normalizeTimerPayload(config = {}) {
        const payload = { ...config };
        const agentId = config.agentId || this.defaultAgentId;
        const team = config.team || this.defaultTeam;

        if (agentId && !payload.agent_id) {
            payload.agent_id = agentId;
        }
        if (team && !payload.team) {
            payload.team = team;
        }

        delete payload.agentId;
        delete payload.pollIntervalMs;
        delete payload.signal;

        return payload;
    }

    async createTimer(config = {}) {
        const payload = this._normalizeTimerPayload(config);
        if (!payload.duration) {
            throw new MinootsError('Timer duration is required');
        }
        return await this._request('POST', '/timers', { body: payload });
    }

    async createTimerWithWebhook(config = {}) {
        const payload = {
            ...this._normalizeTimerPayload(config),
            events: {
                on_expire: {
                    message: config.message || `Timer ${config.name || 'unnamed'} expired`,
                    webhook: config.webhook,
                    data: config.data || {},
                },
            },
        };
        delete payload.message;
        delete payload.webhook;
        delete payload.data;
        return await this.createTimer(payload);
    }

    async createRecurringCheck(name, interval, webhook) {
        return await this.createTimer({
            name,
            duration: interval,
            events: {
                on_expire: {
                    message: `Recurring check: ${name}`,
                    webhook,
                    data: { type: 'recurring_check', interval },
                },
            },
        });
    }

    async getTimer(timerId) {
        if (!timerId) {
            throw new MinootsError('Timer ID is required');
        }
        return await this._request('GET', `/timers/${timerId}`);
    }

    async listTimers(filters = {}) {
        const query = {};
        if (filters.agentId) query.agent_id = filters.agentId;
        if (filters.team) query.team = filters.team;
        if (filters.status) query.status = filters.status;
        if (filters.limit) query.limit = filters.limit;
        if (filters.cursor) query.cursor = filters.cursor;
        return await this._request('GET', '/timers', { query });
    }

    async deleteTimer(timerId) {
        if (!timerId) {
            throw new MinootsError('Timer ID is required');
        }
        return await this._request('DELETE', `/timers/${timerId}`);
    }

    async quickWait(duration, options = {}) {
        const payload = this._normalizeTimerPayload({ ...options, duration });
        if (!payload.name) {
            payload.name = `quick_wait_${Date.now()}`;
        }
        return await this._request('POST', '/quick/wait', { body: payload });
    }

    async waitFor(duration, options = {}) {
        const { pollIntervalMs = 1000, agentId, signal } = options;
        const timer = await this.quickWait(duration, { ...options, agentId });
        const timerId = timer && timer.timer && timer.timer.id;
        if (!timerId) {
            throw new MinootsError('Timer ID missing from quick wait response');
        }
        return await this.pollTimer(timerId, pollIntervalMs, { signal });
    }

    async pollTimer(timerId, intervalMs = 1000, options = {}) {
        const signal = options.signal;
        while (true) {
            if (signal && signal.aborted) {
                throw new MinootsError('Polling aborted by signal');
            }

            const result = await this.getTimer(timerId);
            if (!result || result.success === false) {
                const errorMessage = result && result.error ? result.error : `Failed to fetch timer ${timerId}`;
                throw new MinootsError(errorMessage);
            }

            const timer = result.timer || {};
            if (this._isTimerComplete(timer)) {
                return timer;
            }

            await this._delay(intervalMs, signal);
        }
    }

    async streamTimerEvents(tenantId, options = {}) {
        if (!tenantId) {
            throw new MinootsError('tenantId is required to stream timer events');
        }

        const topics = Array.isArray(options.topics) ? options.topics : [];
        const params = new URLSearchParams({ tenantId });
        topics.forEach((topic) => params.append('topic', topic));

        const controller = new AbortController();
        if (options.signal) {
            if (options.signal.aborted) {
                controller.abort();
            } else {
                options.signal.addEventListener('abort', () => controller.abort(), { once: true });
            }
        }

        const response = await this.fetchImpl(`${this.baseURL}/timers/stream?${params.toString()}`, {
            method: 'GET',
            headers: this._buildHeaders({ Accept: 'text/event-stream' }),
            signal: controller.signal,
        });

        if (!response.body || typeof response.body.getReader !== 'function') {
            throw new MinootsError('Streaming not supported in this environment');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processBuffer = () => {
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                const chunk = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);

                const lines = chunk.split('\n');
                let eventType = 'message';
                let data = '';

                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        eventType = line.slice(6).trim();
                    }
                    if (line.startsWith('data:')) {
                        data += line.slice(5).trim();
                    }
                }

                if (!data) continue;

                try {
                    const payload = JSON.parse(data);
                    if (typeof options.onEvent === 'function') {
                        options.onEvent({ eventType, payload });
                    }
                } catch (error) {
                    if (typeof options.onError === 'function') {
                        options.onError(error);
                    }
                }
            }
        };

        (async () => {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    processBuffer();
                }
            } catch (error) {
                if (typeof options.onError === 'function' && !controller.signal.aborted) {
                    options.onError(error);
                }
            }
        })();

        return () => controller.abort();
    }

    parseDuration(duration) {
        if (typeof duration === 'number') {
            if (Number.isNaN(duration) || duration < 0) {
                throw new MinootsError('Duration must be a positive number');
            }
            return duration;
        }

        const match = duration.toString().trim().match(/^(\d+)(ms|s|m|h|d)$/i);
        if (!match) {
            throw new MinootsError(`Invalid duration: ${duration}`);
        }

        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();

        const multipliers = {
            ms: 1,
            s: 1000,
            m: 60000,
            h: 3600000,
            d: 86400000,
        };

        const multiplier = multipliers[unit];
        if (!multiplier) {
            throw new MinootsError(`Unsupported duration unit: ${unit}`);
        }

        return value * multiplier;
    }

    formatTimeRemaining(milliseconds) {
        const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
        const seconds = totalSeconds % 60;
        const totalMinutes = Math.floor(totalSeconds / 60);
        const minutes = totalMinutes % 60;
        const hours = Math.floor(totalMinutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    _isTimerComplete(timer = {}) {
        if (!timer) return false;
        const status = (timer.status || '').toLowerCase();
        if (['expired', 'completed', 'settled', 'cancelled'].includes(status)) {
            return true;
        }
        if (typeof timer.timeRemaining === 'number' && timer.timeRemaining <= 0) {
            return true;
        }
        return false;
    }

    _delay(ms, signal) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (signal && typeof signal.removeEventListener === 'function') {
                    signal.removeEventListener('abort', onAbort);
                }
                resolve();
            }, ms);

            const onAbort = () => {
                clearTimeout(timeoutId);
                reject(new MinootsError('Polling aborted by signal'));
            };

            if (signal && typeof signal.addEventListener === 'function') {
                if (signal.aborted) {
                    clearTimeout(timeoutId);
                    reject(new MinootsError('Polling aborted by signal'));
                } else {
                    signal.addEventListener('abort', onAbort, { once: true });
                }
            }
        });
    }

    _computeRetryDelay(attempt) {
        const base = Math.min(
            this.retryConfig.maxTimeout,
            this.retryConfig.minTimeout * Math.pow(this.retryConfig.factor, attempt)
        );
        if (!this.retryConfig.jitter) {
            return base;
        }
        const jitter = Math.random() * base * 0.2;
        return Math.max(this.retryConfig.minTimeout, base - jitter);
    }

    _shouldRetry(error, attempt) {
        if (typeof this.retryConfig.shouldRetry === 'function') {
            return this.retryConfig.shouldRetry(error, attempt, this.retryConfig);
        }

        if (error instanceof MinootsTimeoutError) {
            return true;
        }

        if (error instanceof MinootsAPIError) {
            return this.retryConfig.retryOn.includes(error.status);
        }

        return false;
    }

    async _runHooks(hookName, payload) {
        const handlers = this.hooks[hookName];
        if (!Array.isArray(handlers) || handlers.length === 0) {
            return;
        }
        for (const handler of handlers) {
            if (typeof handler !== 'function') continue;
            await handler(payload);
        }
    }
}

module.exports = MinootsSDK;
module.exports.MinootsSDK = MinootsSDK;
module.exports.MinootsError = MinootsError;
module.exports.MinootsTimeoutError = MinootsTimeoutError;
module.exports.MinootsAPIError = MinootsAPIError;
