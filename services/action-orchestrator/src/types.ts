export type ActionKind = 'webhook' | 'command' | 'agent_prompt' | 'workflow_event';

export interface TimerAction {
  id: string;
  kind: ActionKind;
  parameters?: Record<string, unknown>;
  escalation?: {
    afterAttempts?: number;
    escalatesTo?: TimerAction;
  };
}

export interface TimerInstance {
  id: string;
  tenantId: string;
  name: string;
  requestedBy: string;
  status: 'scheduled' | 'armed' | 'fired' | 'cancelled' | 'failed';
  fireAt: string;
  createdAt: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: {
    actions: TimerAction[];
    concurrency?: number;
    retryPolicy?: {
      maxAttempts: number;
      backoffInitialMs: number;
      backoffMultiplier: number;
    };
  }; 
  firedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledBy?: string;
  agentBinding?: {
    adapter: string;
    target: string;
    payloadTemplate: Record<string, unknown>;
    acknowledgementTimeoutMs: number;
  };
}

export type TimerEvent =
  | { type: 'scheduled'; data: TimerInstance }
  | { type: 'fired'; data: TimerInstance }
  | { type: 'cancelled'; data: { timer: TimerInstance; reason?: string } };

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
