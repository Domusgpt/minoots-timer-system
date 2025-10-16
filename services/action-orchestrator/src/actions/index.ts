import { logger } from '../logger';
import { actionFailures, actionLatency } from '../metrics';
import { ActionExecutor, TimerInstance } from '../types';
import { AgentCommandExecutor } from './agentCommand';
import { HttpActionExecutor } from './httpAction';

const executors: ActionExecutor[] = [new HttpActionExecutor(), new AgentCommandExecutor()];

type RetryPolicy = {
  maxAttempts: number;
  backoffInitialMs: number;
  backoffMultiplier: number;
};

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 1,
  backoffInitialMs: 1000,
  backoffMultiplier: 2,
};

type TimerRetryPolicy = NonNullable<TimerInstance['actionBundle']> extends {
  retryPolicy?: infer T;
}
  ? T
  : never;

export const executeActions = async (timer: TimerInstance): Promise<void> => {
  const actions = timer.actionBundle?.actions ?? [];
  const policy = mergeRetryPolicy(timer.actionBundle?.retryPolicy);
  for (const action of actions) {
    const executor = executors.find((handler) => handler.canHandle(action));
    if (!executor) {
      logger.warn({ actionId: action.id }, 'No executor available for action');
      continue;
    }
    await runWithRetry(executor, action, timer, policy);
  }
};

const runWithRetry = async (
  executor: ActionExecutor,
  action: Parameters<ActionExecutor['execute']>[0],
  timer: TimerInstance,
  policy: RetryPolicy,
): Promise<void> => {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const attemptLabel = { action_kind: action.kind, tenant_id: timer.tenantId } as const;
    const start = process.hrtime.bigint();
    try {
      await executor.execute(action, timer);
      const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      actionLatency.observe(attemptLabel, elapsedSeconds);
      return;
    } catch (error) {
      const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      actionLatency.observe(attemptLabel, elapsedSeconds);
      const reason = (error as Error)?.name ?? 'unknown_error';
      actionFailures.inc({ ...attemptLabel, reason });
      const isFinalAttempt = attempt === policy.maxAttempts;
      logger.warn(
        { actionId: action.id, attempt, maxAttempts: policy.maxAttempts, timerId: timer.id, error },
        'Action execution failed',
      );
      if (isFinalAttempt) {
        return;
      }
      const backoff = policy.backoffInitialMs * Math.pow(policy.backoffMultiplier, attempt - 1);
      await delay(backoff);
    }
  }
};

const mergeRetryPolicy = (policy?: TimerRetryPolicy): RetryPolicy => {
  return {
    maxAttempts: policy?.maxAttempts && policy.maxAttempts > 0 ? policy.maxAttempts : DEFAULT_RETRY.maxAttempts,
    backoffInitialMs:
      policy?.backoffInitialMs !== undefined && policy.backoffInitialMs >= 0
        ? policy.backoffInitialMs
        : DEFAULT_RETRY.backoffInitialMs,
    backoffMultiplier:
      policy?.backoffMultiplier && policy.backoffMultiplier > 0
        ? policy.backoffMultiplier
        : DEFAULT_RETRY.backoffMultiplier,
  };
};

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const registerExecutor = (executor: ActionExecutor) => {
  executors.push(executor);
};
