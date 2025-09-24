import { z } from 'zod';

type TimerActionDefinition = {
  id: string;
  kind: 'webhook' | 'command' | 'agent_prompt' | 'workflow_event';
  parameters?: Record<string, unknown>;
  escalation?: {
    afterAttempts?: number;
    escalatesTo?: TimerActionDefinition;
  };
};

const timerActionSchemaInternal: z.ZodType<TimerActionDefinition> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    kind: z.enum(['webhook', 'command', 'agent_prompt', 'workflow_event']),
    parameters: z.record(z.unknown()).default({}),
    escalation: z
      .object({
        afterAttempts: z.number().int().positive().default(1),
        escalatesTo: timerActionSchemaInternal.optional(),
      })
      .optional(),
  }),
);

export const timerActionSchema = timerActionSchemaInternal;

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

const agentBindingDefinitionSchema = z.object({
  adapter: z.enum(['mcp', 'langchain', 'autogen', 'custom']).default('mcp'),
  target: z.string().min(1),
  payloadTemplate: z.record(z.unknown()).default({}),
  acknowledgementTimeoutMs: z.number().int().positive().default(60000),
});

export const agentBindingSchema = agentBindingDefinitionSchema.optional();

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
export type TimerAction = z.infer<typeof timerActionSchemaInternal>;
export type TimerActionBundle = z.infer<typeof timerActionBundleSchema>;
export type AgentBinding = z.infer<typeof agentBindingDefinitionSchema>;

export type TimerStatus = 'scheduled' | 'armed' | 'fired' | 'cancelled' | 'failed';

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
}
