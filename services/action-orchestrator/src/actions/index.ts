import { logger } from '../logger';
import {
  CommandAction,
  TimerAction,
  TimerActionExecutor,
  TimerInstance,
  WebhookAction,
  ActionExecutionResult,
  TimerExecutionError,
} from '../types';
import { AgentCommandExecutor } from './agentCommand';
import { HttpActionExecutor } from './httpAction';

class DefaultTimerActionExecutor implements TimerActionExecutor {
  constructor(
    private readonly httpExecutor = new HttpActionExecutor(),
    private readonly commandExecutor = new AgentCommandExecutor(),
  ) {}

  async executeWebhook(action: WebhookAction, timer: TimerInstance): Promise<ActionExecutionResult> {
    const result = await this.httpExecutor.execute(action, timer);
    if (result.success) {
      logger.info({ actionId: action.id, timerId: timer.id }, 'Webhook action completed');
    } else {
      logger.warn({ actionId: action.id, timerId: timer.id, output: result.output }, 'Webhook action failed');
    }
    return result;
  }

  async executeCommand(action: CommandAction, timer: TimerInstance): Promise<ActionExecutionResult> {
    const result = await this.commandExecutor.execute(action, timer);
    if (!result.success) {
      logger.warn({ actionId: action.id, timerId: timer.id }, 'Command execution reported failure');
    }
    return result;
  }
}

let executor: TimerActionExecutor = new DefaultTimerActionExecutor();

export interface ExecutionSummary {
  results: ActionExecutionResult[];
  success: boolean;
  completedAtIso: string;
  error?: TimerExecutionError;
}

export const executeActions = async (timer: TimerInstance): Promise<ExecutionSummary> => {
  const actions: TimerAction[] = timer.actionBundle?.actions ?? [];
  const results: ActionExecutionResult[] = [];
  for (const action of actions) {
    try {
      if (action.kind === 'webhook') {
        const result = await executor.executeWebhook(action as WebhookAction, timer);
        results.push(result);
      } else if (action.kind === 'command' || action.kind === 'agent_prompt') {
        const result = await executor.executeCommand(action as CommandAction, timer);
        results.push(result);
      } else {
        logger.warn({ actionId: action.id, kind: action.kind }, 'Unsupported timer action kind');
      }
    } catch (error) {
      logger.error({ actionId: action.id, timerId: timer.id, error }, 'Timer action execution failed');
      results.push({ actionId: action.id, success: false, output: (error as Error)?.message ?? 'Unknown error' });
    }
  }
  const success = results.every((result) => result.success);
  const completedAtIso = new Date().toISOString();

  let error: TimerExecutionError | undefined;
  if (!success) {
    const failed = results.filter((result) => !result.success);
    error = {
      message: 'One or more timer actions failed',
      code: 'ACTION_FAILURE',
      metadata: {
        failedActionIds: failed.map((item) => item.actionId),
      },
    };
  }

  return { results, success, completedAtIso, error };
};

export const registerExecutor = (customExecutor: TimerActionExecutor) => {
  executor = customExecutor;
};
