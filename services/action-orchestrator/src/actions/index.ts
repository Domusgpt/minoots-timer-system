import { logger } from '../logger';
import { ActionExecutor, TimerInstance } from '../types';
import { AgentCommandExecutor } from './agentCommand';
import { HttpActionExecutor } from './httpAction';

const executors: ActionExecutor[] = [new HttpActionExecutor(), new AgentCommandExecutor()];

export const executeActions = async (timer: TimerInstance): Promise<void> => {
  const actions = timer.actionBundle?.actions ?? [];
  for (const action of actions) {
    const executor = executors.find((handler) => handler.canHandle(action));
    if (!executor) {
      continue;
    }
    try {
      await executor.execute(action, timer);
    } catch (error) {
      // Individual executors already log errors; ensure the orchestrator keeps running.
      logger.warn({ actionId: action.id, timerId: timer.id, error }, 'Action execution threw unexpectedly');
    }
  }
};

export const registerExecutor = (executor: ActionExecutor) => {
  executors.push(executor);
};
