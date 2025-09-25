export type ActionKind = 'webhook' | 'command' | 'agent_prompt' | 'workflow_event';

interface TimerActionBase {
  id: string;
  kind: ActionKind;
  parameters: Record<string, unknown>;
}

export interface WebhookAction extends TimerActionBase {
  kind: 'webhook';
  parameters: Record<string, unknown>;
}

export interface CommandAction extends TimerActionBase {
  kind: 'command' | 'agent_prompt';
  parameters: Record<string, unknown>;
}

export interface WorkflowAction extends TimerActionBase {
  kind: 'workflow_event';
}

export type TimerAction = WebhookAction | CommandAction | WorkflowAction;

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
  };
  firedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledBy?: string;
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

export interface TimerActionExecutor {
  executeWebhook(action: WebhookAction, timer: TimerInstance): Promise<void>;
  executeCommand(action: CommandAction, timer: TimerInstance): Promise<void>;
}
