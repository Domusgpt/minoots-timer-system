import { logger } from '../logger';
import { ActionExecutor, TimerInstance, TimerAction } from '../types';
import { actionDispatchCounter, actionDurationHistogram, actionRetryCounter } from '../metrics';
import { AgentCommandExecutor, agentCommandSchema } from './agentCommand';
import { HttpActionExecutor, httpActionSchema } from './httpAction';
import { registerActionSchema, validateActionParameters } from '../schema/registry';

const executors: ActionExecutor[] = [new HttpActionExecutor(), new AgentCommandExecutor()];

registerActionSchema('webhook', httpActionSchema);
registerActionSchema('agent_prompt', agentCommandSchema);

export const executeActions = async (timer: TimerInstance): Promise<void> => {
  const actions = timer.actionBundle?.actions ?? [];
  for (const action of actions) {
    const executor = executors.find((handler) => handler.canHandle(action));
    if (!executor) {
      continue;
    }
    const normalizedAction = validateActionParameters(action);
    await executeWithRetry(executor, normalizedAction, timer);
  }
};

export const registerExecutor = (executor: ActionExecutor) => {
  executors.push(executor);
};

const executeWithRetry = async (
  executor: ActionExecutor,
  action: TimerAction,
  timer: TimerInstance,
): Promise<void> => {
  const policy = normalizeRetryPolicy(action.retryPolicy);
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const endTimer = actionDurationHistogram.startTimer({ action_kind: action.kind });
    try {
      const result = await executor.execute(action, timer);
      endTimer();
      actionDispatchCounter.inc({ action_kind: action.kind, result: result.success ? 'success' : 'failure' });
      if (result.success) {
        return;
      }
    } catch (error) {
      endTimer();
      actionDispatchCounter.inc({ action_kind: action.kind, result: 'error' });
      logger.warn({ actionId: action.id, timerId: timer.id, error }, 'Action execution threw unexpectedly');
    }

    if (attempt < policy.maxAttempts) {
      actionRetryCounter.inc({ action_kind: action.kind });
      const delay = policy.backoffInitialMs * Math.pow(policy.backoffMultiplier, attempt - 1);
      await sleep(delay);
    }
  }
};

const normalizeRetryPolicy = (
  policy: TimerAction['retryPolicy'],
): { maxAttempts: number; backoffInitialMs: number; backoffMultiplier: number } => ({
  maxAttempts: Math.max(1, policy?.maxAttempts ?? 1),
  backoffInitialMs: Math.max(50, policy?.backoffInitialMs ?? 500),
  backoffMultiplier: Math.max(1, policy?.backoffMultiplier ?? 2),
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
