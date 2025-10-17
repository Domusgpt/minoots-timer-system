type RequestInit = globalThis.RequestInit;
type Response = globalThis.Response;
type URL = globalThis.URL;

export type DurationInput = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;

export interface ParseratorScheduling {
    mode?: 'immediate' | 'absolute' | 'relative' | 'delay' | string;
    offsetMinutes?: number;
    basePath?: string | null;
    datePath?: string | null;
    delayMsPath?: string | null;
    [key: string]: unknown;
}

export interface ParseratorSourceInput {
    name?: string;
    description?: string;
    projectId?: string | null;
    pipelineId?: string | null;
    templateId?: string | null;
    defaultTimer?: Record<string, unknown>;
    mapping?: Record<string, unknown>;
    filters?: Record<string, unknown>;
    scheduling?: ParseratorScheduling;
    insightPaths?: string[];
    tags?: string[];
    enabled?: boolean;
}

export interface ParseratorSource extends ParseratorSourceInput {
    id: string;
    teamId: string;
    webhookUrlPath: string;
    webhookSecret?: string;
    secretPreview?: string;
    createdAt?: unknown;
    updatedAt?: unknown;
    lastEventAt?: unknown;
    lastEventId?: string | null;
    lastEventStatus?: string | null;
}

export interface ParseratorPreviewInsight {
    path: string;
    value: unknown;
}

export interface ParseratorPreviewAction {
    type: string;
    timer: Record<string, unknown>;
    scheduledFor?: Date | string | number | null;
    insights?: ParseratorPreviewInsight[];
}

export interface ListParseratorEventsOptions {
    status?: string;
    sourceId?: string;
    limit?: number;
}

export interface ParseratorEvent {
    id: string;
    sourceId: string;
    teamId: string;
    status: string;
    skipReason?: string | null;
    actionCount?: number;
    receivedAt?: unknown;
    payload?: Record<string, unknown> | null;
    headers?: Record<string, unknown>;
}

export interface ListParseratorActionsOptions {
    status?: string;
    sourceId?: string;
    limit?: number;
}

export interface ParseratorAction {
    id: string;
    sourceId: string;
    teamId: string;
    eventId: string;
    status: string;
    scheduledFor?: unknown;
    timer?: Record<string, unknown>;
    insights?: ParseratorPreviewInsight[];
    attempts?: number;
    result?: Record<string, unknown>;
    lastError?: string;
}

export interface UpdateParseratorActionRequest {
    status?: string;
    deferUntil?: string | number | Date;
    result?: Record<string, unknown>;
    notes?: string;
    resetAttempts?: boolean;
}

export interface ReplayParseratorActionRequest {
    scheduledFor?: string | number | Date;
    notes?: string;
    id?: string;
}

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
    timer?: Timer;
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

    listParseratorSources(teamId?: string): Promise<ParseratorSource[]>;
    createParseratorSource(teamId: string | undefined, config: ParseratorSourceInput): Promise<ParseratorSource>;
    getParseratorSource(teamId: string | undefined, sourceId: string): Promise<ParseratorSource>;
    updateParseratorSource(teamId: string | undefined, sourceId: string, updates: Partial<ParseratorSourceInput>): Promise<ParseratorSource>;
    rotateParseratorSourceSecret(teamId: string | undefined, sourceId: string): Promise<ParseratorSource>;
    deleteParseratorSource(teamId: string | undefined, sourceId: string): Promise<{ actionsDeleted: number; eventsDeleted: number }>;
    previewParseratorSource(teamId: string | undefined, sourceId: string, samplePayload?: Record<string, unknown>): Promise<ParseratorPreviewAction[]>;
    listParseratorEvents(teamId?: string, options?: ListParseratorEventsOptions): Promise<ParseratorEvent[]>;
    listParseratorActions(teamId?: string, options?: ListParseratorActionsOptions): Promise<ParseratorAction[]>;
    updateParseratorActionStatus(teamId: string | undefined, actionId: string, updates: UpdateParseratorActionRequest): Promise<ParseratorAction>;
    replayParseratorAction(teamId: string | undefined, actionId: string, options?: ReplayParseratorActionRequest): Promise<ParseratorAction>;

    quickWait(duration: DurationInput, options?: QuickWaitOptions): Promise<CreateTimerResponse>;
    waitFor(duration: DurationInput, options?: WaitForOptions): Promise<Timer>;
    pollTimer(timerId: string, intervalMs?: number, options?: PollTimerOptions): Promise<Timer>;

    streamTimerEvents<T = unknown>(tenantId: string, options?: StreamOptions<T>): () => void;

    parseDuration(duration: DurationInput): number;
    formatTimeRemaining(milliseconds: number): string;
}

export class MinootsError extends Error {}

export class MinootsTimeoutError extends MinootsError {}

export class MinootsAPIError extends MinootsError {
    constructor(message: string, status: number, details?: unknown, options?: ErrorOptions);
    readonly status: number;
    readonly details: unknown;
}

export default MinootsSDK;
