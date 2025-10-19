type RequestInit = globalThis.RequestInit;
type Response = globalThis.Response;
type URL = globalThis.URL;

export type DurationInput = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;

export interface TimerEvent {
    message?: string;
    webhook?: string;
    data?: Record<string, unknown>;
}

export interface TimerEventsConfig {
    on_expire?: TimerEvent;
    on_start?: TimerEvent;
    on_cancel?: TimerEvent;
    [key: string]: TimerEvent | undefined;
}

export type TimerStatus =
    | 'scheduled'
    | 'running'
    | 'paused'
    | 'expired'
    | 'completed'
    | 'settled'
    | 'cancelled'
    | string;

export interface Timer {
    id: string;
    name?: string;
    status: TimerStatus;
    duration?: number;
    timeRemaining?: number;
    progress?: number;
    createdAt?: string;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
    agent_id?: string;
    team?: string;
    [key: string]: unknown;
}

export interface TimerResponse {
    success: boolean;
    timer: Timer;
    error?: string;
}

export interface CreateTimerResponse extends TimerResponse {}

export interface DeleteTimerResponse {
    success: boolean;
    deleted: boolean;
    cascade: {
        timers: number;
        expirations: number;
        logs: number;
        metrics: number;
        replayEntries: number;
        [key: string]: number;
    };
    error?: string;
}

export interface ReplayTimerOptions {
    reason?: string;
    metadata?: Record<string, unknown>;
    context?: Record<string, unknown>;
    duration?: DurationInput;
    events?: TimerEventsConfig;
    dependencies?: string[];
    retryPolicy?: Record<string, unknown>;
    team?: string;
    agentId?: string;
    [key: string]: unknown;
}

export interface ReplayTimerResponse {
    success: boolean;
    replay: Timer;
    error?: string;
}

export interface ListTimersResponse {
    success: boolean;
    timers: Timer[];
    count: number;
    nextCursor?: string;
    error?: string;
}

export interface HealthResponse {
    status: string;
    timestamp: number | string;
    service?: string;
    version?: string;
    [key: string]: unknown;
}

export interface StreamEvent<T = unknown> {
    eventType: string;
    payload: T;
}

export interface StreamOptions<T = unknown> {
    topics?: string[];
    signal?: AbortSignal;
    onEvent?: (event: StreamEvent<T>) => void;
    onError?: (error: unknown) => void;
}

export interface WebhookTemplate {
    key: string;
    name: string;
    description?: string;
    samplePayload?: Record<string, unknown>;
    defaultEvents?: string[];
    [key: string]: unknown;
}

export interface Webhook {
    id: string;
    url: string;
    description?: string | null;
    events?: string[];
    headers?: Record<string, string>;
    active?: boolean;
    timeoutMs?: number;
    lastDeliveredAt?: number | string | null;
    lastStatus?: string | null;
    templateKey?: string | null;
    [key: string]: unknown;
}

export interface WebhookLogsResponse {
    entries: Array<{
        id: string;
        teamId: string;
        webhookId: string;
        eventId: string;
        eventType: string;
        status: string;
        attempt?: number;
        responseCode?: number | null;
        responseBody?: string | null;
        error?: string | null;
        createdAt?: number | string;
        durationMs?: number;
        [key: string]: unknown;
    }>;
    nextCursor: string | null;
}

export interface CreateWebhookResult {
    success: boolean;
    webhook: Webhook;
    secret?: string;
}

export interface DeleteWebhookResult {
    success: boolean;
    deleted: boolean;
}

export interface PublishEventResult {
    success: boolean;
    eventId: string;
    deliveries: unknown[];
}

export interface IntegrationRecord {
    id: string;
    teamId: string;
    type: string;
    createdAt?: number | string;
    updatedAt?: number | string;
    configuration: Record<string, unknown>;
}

export type WebhookUpdate = Partial<Omit<Webhook, 'id'>> & { rotateSecret?: boolean };

export interface ListTimersFilters {
    agentId?: string;
    team?: string;
    status?: string;
    limit?: number;
    cursor?: string;
}

export interface CreateTimerRequest {
    name?: string;
    duration: DurationInput;
    agentId?: string;
    team?: string;
    metadata?: Record<string, unknown>;
    events?: TimerEventsConfig;
    [key: string]: unknown;
}

export interface CreateTimerWithWebhookRequest extends CreateTimerRequest {
    webhook: string;
    message?: string;
    data?: Record<string, unknown>;
}

export interface QuickWaitOptions extends Omit<CreateTimerRequest, 'duration'> {}

export interface WaitForOptions extends QuickWaitOptions {
    pollIntervalMs?: number;
    signal?: AbortSignal;
}

export interface PollTimerOptions {
    signal?: AbortSignal;
}

export interface MinootsSDKOptions {
    baseURL?: string;
    agentId?: string;
    team?: string;
    apiKey?: string | null;
    timeout?: number;
    userAgent?: string;
    fetch?: typeof fetch;
    retry?: RetryOptions;
    hooks?: Partial<SDKHooks>;
}

export interface RetryOptions {
    attempts?: number;
    minTimeout?: number;
    maxTimeout?: number;
    factor?: number;
    jitter?: boolean;
    retryOn?: number[];
    shouldRetry?: (error: unknown, attempt: number, config: RequiredRetryOptions) => boolean;
}

export interface RequiredRetryOptions {
    attempts: number;
    minTimeout: number;
    maxTimeout: number;
    factor: number;
    jitter: boolean;
    retryOn: number[];
}

export interface RequestHookContext {
    url: URL;
    requestConfig: RequestInit;
    attempt: number;
}

export interface ResponseHookContext extends RequestHookContext {
    response: Response;
}

export interface RetryHookContext extends RequestHookContext {
    error: unknown;
}

export interface SDKHooks {
    beforeRequest: Array<(context: RequestHookContext) => void | Promise<void>>;
    afterResponse: Array<(context: ResponseHookContext) => void | Promise<void>>;
    onRetry: Array<(context: RetryHookContext) => void | Promise<void>>;
}

export class MinootsSDK {
    constructor(options?: MinootsSDKOptions);

    readonly baseURL: string;
    readonly timeout: number;
    defaultAgentId?: string;
    defaultTeam?: string;
    readonly retryConfig: RequiredRetryOptions & { shouldRetry?: RetryOptions['shouldRetry'] };

    withDefaults(overrides?: Partial<MinootsSDKOptions>): MinootsSDK;

    withApiKey(apiKey: string | null): MinootsSDK;
    setApiKey(apiKey: string | null): void;

    withAgent(agentId: string | undefined): MinootsSDK;
    setAgent(agentId: string | undefined): void;

    withTeam(team: string | undefined): MinootsSDK;
    setTeam(team: string | undefined): void;

    withRetry(options: RetryOptions): MinootsSDK;
    setRetry(options: RetryOptions): void;

    health(): Promise<HealthResponse>;

    createTimer(config: CreateTimerRequest): Promise<CreateTimerResponse>;
    createTimerWithWebhook(config: CreateTimerWithWebhookRequest): Promise<CreateTimerResponse>;
    createRecurringCheck(name: string, interval: DurationInput, webhook: string): Promise<CreateTimerResponse>;

    getTimer(timerId: string): Promise<TimerResponse>;
    listTimers(filters?: ListTimersFilters): Promise<ListTimersResponse>;
    deleteTimer(timerId: string): Promise<DeleteTimerResponse>;
    replayTimer(timerId: string, options?: ReplayTimerOptions): Promise<ReplayTimerResponse>;

    quickWait(duration: DurationInput, options?: QuickWaitOptions): Promise<CreateTimerResponse>;
    waitFor(duration: DurationInput, options?: WaitForOptions): Promise<Timer>;
    pollTimer(timerId: string, intervalMs?: number, options?: PollTimerOptions): Promise<Timer>;

    streamTimerEvents<T = unknown>(tenantId: string, options?: StreamOptions<T>): () => void;

    parseDuration(duration: DurationInput): number;
    formatTimeRemaining(milliseconds: number): string;

    listWebhookTemplates(teamId: string): Promise<WebhookTemplate[]>;
    createWebhook(teamId: string, config: Partial<Webhook> & { url: string }): Promise<CreateWebhookResult>;
    createWebhookFromTemplate(teamId: string, templateKey: string, overrides: Partial<Webhook> & { url: string }): Promise<CreateWebhookResult>;
    listWebhooks(teamId: string): Promise<Webhook[]>;
    updateWebhook(teamId: string, webhookId: string, updates: WebhookUpdate): Promise<Webhook>;
    deleteWebhook(teamId: string, webhookId: string): Promise<DeleteWebhookResult>;
    triggerWebhookTest(teamId: string, webhookId: string): Promise<PublishEventResult>;
    getWebhookLogs(teamId: string, webhookId: string, options?: { limit?: number; cursor?: string }): Promise<WebhookLogsResponse>;
    publishEvent(teamId: string, eventType: string, payload?: Record<string, unknown>): Promise<PublishEventResult>;

    listIntegrations(teamId: string): Promise<IntegrationRecord[]>;
    upsertIntegration(teamId: string, type: string, config: Record<string, unknown>): Promise<IntegrationRecord>;
    deleteIntegration(teamId: string, type: string): Promise<{ success: boolean; deleted: boolean }>;
    testIntegration(teamId: string, type: string): Promise<{ success: boolean; response: unknown }>;
    notifyIntegration(teamId: string, type: string, message?: Record<string, unknown>): Promise<{ success: boolean; response: unknown }>;
}

export class MinootsError extends Error {}

export class MinootsTimeoutError extends MinootsError {}

export class MinootsAPIError extends MinootsError {
    constructor(message: string, status: number, details?: unknown, options?: ErrorOptions);
    readonly status: number;
    readonly details: unknown;
}

export default MinootsSDK;
