import { z } from 'zod';

type TimerActionShape = {
  id: string;
  kind: 'webhook' | 'command' | 'agent_prompt' | 'workflow_event';
  parameters: Record<string, unknown>;
  escalation?: {
    afterAttempts: number;
    escalatesTo?: TimerActionShape;
  };
};

type TimerActionInput = Omit<TimerActionShape, 'parameters' | 'escalation'> & {
  parameters?: Record<string, unknown>;
  escalation?: {
    afterAttempts?: number;
    escalatesTo?: TimerActionInput;
  };
};

const timerActionLazy: z.ZodType<TimerActionShape, z.ZodTypeDef, TimerActionInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    kind: z.enum(['webhook', 'command', 'agent_prompt', 'workflow_event']),
    parameters: z.record(z.unknown()).default({}),
    escalation: z
      .object({
        afterAttempts: z.number().int().positive().default(1),
        escalatesTo: timerActionLazy.optional(),
      })
      .optional(),
  }),
);

export const timerActionSchema = timerActionLazy;

export const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().positive().default(1),
    backoffInitialMs: z.number().int().nonnegative().default(1000),
    backoffMultiplier: z.number().positive().default(2),
  })
  .optional();

export const timerActionBundleSchema = z.object({
  actions: z.array(timerActionSchema).min(1),
  concurrency: z.number().int().positive().default(1),
  retryPolicy: retryPolicySchema,
});

export const agentBindingSchema = z
  .object({
    adapter: z.enum(['mcp', 'langchain', 'autogen', 'custom']).default('mcp'),
    target: z.string().min(1),
    payloadTemplate: z.record(z.any()).default({}),
    acknowledgementTimeoutMs: z.number().int().positive().default(60000),
  })
  .optional();

const temporalGraphNodeSchema = z.object({
  id: z.string().min(1),
  after: z.array(z.string().min(1)).default([]),
  offset: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
  offsetMs: z.number().int().nonnegative().optional(),
  duration: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  durationMs: z.number().int().positive().optional(),
  metadata: z.record(z.any()).optional(),
  labels: z.record(z.string()).optional(),
  actionBundle: timerActionBundleSchema.optional(),
  agentBinding: agentBindingSchema,
});

const temporalGraphSchema = z
  .object({
    root: z.string().min(1).default('root'),
    nodes: z.array(temporalGraphNodeSchema).min(1),
  })
  .optional();

const jitterCompensationSchema = z
  .object({
    maxCompensationMs: z.number().int().nonnegative().default(0),
    smoothingFactor: z.number().positive().max(1).default(0.2),
  })
  .optional();

export const timerCreateSchema = z
  .object({
    tenantId: z.string().min(1),
    requestedBy: z.string().min(1),
    name: z.string().min(1).optional(),
    duration: z.union([z.string().min(2), z.number().int().positive()]).optional(),
    fireAt: z.string().datetime().optional(),
    metadata: z.record(z.any()).optional(),
    labels: z.record(z.string()).optional(),
    actionBundle: timerActionBundleSchema.optional(),
    agentBinding: agentBindingSchema,
    temporalGraph: temporalGraphSchema,
    jitterPolicy: jitterCompensationSchema,
  })
  .refine(
    (value) => Boolean(value.duration ?? value.fireAt),
    'Either duration or fireAt must be provided',
  );

export const timerCancelSchema = z.object({
  tenantId: z.string().min(1),
  requestedBy: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export type TimerCreateInput = z.infer<typeof timerCreateSchema>;
export type TimerCancelInput = z.infer<typeof timerCancelSchema>;
export type TimerAction = z.infer<typeof timerActionSchema>;
export type TimerActionBundle = z.infer<typeof timerActionBundleSchema>;
export type AgentBinding = z.infer<typeof agentBindingSchema>;
export type TimerGraphNodeInput = z.infer<typeof temporalGraphNodeSchema>;
export type TimerGraphInput = z.infer<typeof temporalGraphSchema>;
export type JitterPolicyInput = z.infer<typeof jitterCompensationSchema>;

export type TimerStatus = 'scheduled' | 'armed' | 'fired' | 'cancelled' | 'failed' | 'settled';

export interface TemporalGraphNode {
  id: string;
  after: string[];
  offsetMs: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: TimerActionBundle;
  agentBinding?: AgentBinding;
}

export interface TimerGraphDefinition {
  root: string;
  nodes: TemporalGraphNode[];
}

export interface JitterPolicy {
  maxCompensationMs: number;
  smoothingFactor: number;
}

export interface TimerRecord {
  id: string;
  tenantId: string;
  requestedBy: string;
  name: string;
  durationMs: number;
  createdAt: string;
  fireAt: string;
  status: TimerStatus;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: TimerActionBundle;
  agentBinding?: AgentBinding;
  firedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledBy?: string;
  settledAt?: string;
  failureReason?: string;
  stateVersion?: number;
  temporalGraph?: TimerGraphDefinition;
  graphRootId?: string;
  graphNodeId?: string;
  jitterPolicy?: JitterPolicy;
}

export type TimerEvent =
  | { type: 'scheduled'; data: TimerRecord }
  | { type: 'fired'; data: TimerRecord }
  | { type: 'cancelled'; data: { timer: TimerRecord; reason?: string } }
  | { type: 'settled'; data: TimerRecord };

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
