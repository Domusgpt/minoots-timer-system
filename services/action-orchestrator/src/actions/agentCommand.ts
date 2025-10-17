import { z } from 'zod';
import { ActionExecutor, ExecutionResult, TimerAction, TimerInstance } from '../types';
import { logger } from '../logger';
import { AgentCommandBus, createDefaultAgentCommandBus } from '../commandBus';

const agentCommandSchema = z.object({
  adapter: z.enum(['mcp', 'langchain', 'autogen', 'custom', 'webhook']).default('mcp'),
  target: z.string().min(1),
  payload: z.record(z.any()).default({}),
});

export class AgentCommandExecutor implements ActionExecutor {
  constructor(private readonly commandBus: AgentCommandBus = createDefaultAgentCommandBus()) {}

  canHandle(action: TimerAction): boolean {
    return action.kind === 'agent_prompt';
  }

  async execute(action: TimerAction, timer: TimerInstance): Promise<ExecutionResult> {
    const payload = agentCommandSchema.parse(action.parameters ?? {});
    logger.info(
      { actionId: action.id, adapter: payload.adapter, target: payload.target, timerId: timer.id },
      'Dispatching agent command',
    );

    const ack = await this.commandBus.dispatch({
      adapter: payload.adapter,
      target: payload.target,
      payload: payload.payload,
      timer,
      action,
    });

    const success = ack.status === 'acknowledged';

    return {
      actionId: action.id,
      success,
      output: success
        ? `Agent ${payload.target} acknowledged command via ${ack.connector}`
        : `Agent ${payload.target} rejected command via ${ack.connector}`,
      metadata: {
        adapter: payload.adapter,
        target: payload.target,
        ack,
      },
    };
  }
}
