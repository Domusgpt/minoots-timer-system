import { z } from 'zod';
import { ActionExecutor, ExecutionResult, TimerAction, TimerInstance } from '../types';
import { logger } from '../logger';
import { AgentProgressUpdate, createAgentCommandBus } from '../infra/agentCommandBus';

const agentCommandSchema = z.object({
  adapter: z.enum(['mcp', 'langchain', 'autogen', 'custom']).default('mcp'),
  target: z.string().min(1),
  payload: z.record(z.any()).default({}),
});

export class AgentCommandExecutor implements ActionExecutor {
  constructor(private readonly bus = createAgentCommandBus()) {}

  canHandle(action: TimerAction): boolean {
    return action.kind === 'agent_prompt';
  }

  async execute(action: TimerAction, timer: TimerInstance): Promise<ExecutionResult> {
    const payload = agentCommandSchema.parse(action.parameters ?? {});
    const progress: AgentProgressUpdate[] = [];
    const response = await this.bus.dispatch({
      adapter: payload.adapter,
      target: payload.target,
      payload: payload.payload,
      timer,
      onProgress: (update) => {
        progress.push(update);
        logger.info(
          { actionId: action.id, timerId: timer.id, stage: update.stage, connector: payload.adapter },
          'Agent command progress',
        );
      },
    });

    const success = response.status === 'accepted';
    const output = success
      ? `Command accepted by ${response.connector}`
      : `Command rejected by ${response.connector}`;

    return {
      actionId: action.id,
      success,
      output,
      metadata: {
        adapter: payload.adapter,
        target: payload.target,
        connector: response.connector,
        referenceId: response.referenceId,
        progress,
      },
    };
  }
}
