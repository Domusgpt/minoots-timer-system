export type ActionKind = 'webhook' | 'command' | 'agent_prompt' | 'workflow_event';

export interface TimerAction {
  id: string;
  kind: ActionKind;
  parameters: Record<string, unknown>;
}

export interface TimerInstance {
  id: string;
  tenantId: string;
  name: string;
  requestedBy: string;
  status: 'scheduled' | 'armed' | 'fired' | 'cancelled' | 'failed' | 'settled';
  fireAt: string;
  createdAt: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: {
    actions: TimerAction[];
    concurrency?: number;
    retryPolicy?: {
      maxAttempts?: number;
      backoffInitialMs?: number;
      backoffMultiplier?: number;
    };
  };
  firedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledBy?: string;
  settledAt?: string;
  failureReason?: string;
  stateVersion?: number;
  graphRootId?: string;
  graphNodeId?: string;
  temporalGraph?: Record<string, unknown>;
  jitterPolicy?: Record<string, unknown>;
}

export type TimerEvent =
  | { type: 'scheduled'; data: TimerInstance }
  | { type: 'fired'; data: TimerInstance }
  | { type: 'cancelled'; data: { timer: TimerInstance; reason?: string } }
  | { type: 'settled'; data: TimerInstance };

export type TimerEventType = TimerEvent['type'];

export interface TimerEventEnvelope {
  envelopeId: string;
  tenantId: string;
  occurredAtIso: string;
  dedupeKey: string;
  traceId?: string;
  signature: string;
  signatureVersion: string;
  eventType: TimerEventType;
  event: TimerEvent;
}

export interface AgentCommandProgress {
  stage: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionResult {
  actionId: string;
  success: boolean;
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionExecutor {
  canHandle(action: TimerAction): boolean;
  execute(action: TimerAction, timer: TimerInstance): Promise<ExecutionResult>;
}
