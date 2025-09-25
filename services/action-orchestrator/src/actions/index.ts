import { logger } from '../logger';
import {
  CommandAction,
  TimerAction,
  TimerActionExecutor,
  TimerInstance,
  WebhookAction,
} from '../types';
import { AgentCommandExecutor } from './agentCommand';
import { HttpActionExecutor } from './httpAction';

class DefaultTimerActionExecutor implements TimerActionExecutor {
  constructor(
    private readonly httpExecutor = new HttpActionExecutor(),
    private readonly commandExecutor = new AgentCommandExecutor(),
  ) {}

  async executeWebhook(action: WebhookAction, timer: TimerInstance): Promise<void> {
    const result = await this.httpExecutor.execute(action, timer);
    if (result.success) {
      logger.info({ actionId: action.id, timerId: timer.id }, 'Webhook action completed');
    } else {
      logger.warn({ actionId: action.id, timerId: timer.id, output: result.output }, 'Webhook action failed');
    }
  }

  async executeCommand(action: CommandAction, timer: TimerInstance): Promise<void> {
    const result = await this.commandExecutor.execute(action, timer);
    if (!result.success) {
      logger.warn({ actionId: action.id, timerId: timer.id }, 'Command execution reported failure');
    }
  }
}

let executor: TimerActionExecutor = new DefaultTimerActionExecutor();

export const executeActions = async (timer: TimerInstance): Promise<void> => {
  const actions: TimerAction[] = timer.actionBundle?.actions ?? [];
  for (const action of actions) {
    try {
      if (action.kind === 'webhook') {
        await executor.executeWebhook(action as WebhookAction, timer);
      } else if (action.kind === 'command' || action.kind === 'agent_prompt') {
        await executor.executeCommand(action as CommandAction, timer);
      } else {
        logger.warn({ actionId: action.id, kind: action.kind }, 'Unsupported timer action kind');
      }
    } catch (error) {
      logger.error({ actionId: action.id, timerId: timer.id, error }, 'Timer action execution failed');
    }
  }
};

export const registerExecutor = (customExecutor: TimerActionExecutor) => {
  executor = customExecutor;
};
