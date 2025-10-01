import { createEventSource } from './infra/eventSource';
import { executeActions } from './actions';
import { logger } from './logger';
import { TimerEvent } from './types';
import { createKernelExecutionReporter, KernelExecutionReporter } from './infra/kernelClient';

const handleEvent = async (event: TimerEvent, reporter?: KernelExecutionReporter): Promise<void> => {
  switch (event.type) {
    case 'scheduled':
      logger.debug({ timerId: event.data.id }, 'Timer scheduled');
      break;
    case 'fired':
      logger.info({ timerId: event.data.id }, 'Timer fired — executing actions');
      {
        const summary = await executeActions(event.data);
        if (!summary.success) {
          logger.warn({ timerId: event.data.id, failedActions: summary.error?.metadata }, 'Timer actions reported failure');
        }

        if (reporter) {
          try {
            await reporter.report(event.data, summary);
          } catch (error) {
            logger.error({ error, timerId: event.data.id }, 'Failed to report timer execution to kernel');
          }
        }
      }
      break;
    case 'cancelled':
      logger.info({ timerId: event.data.timer.id, reason: event.data.reason }, 'Timer cancelled');
      break;
    case 'failed':
      logger.error({ timerId: event.data.timer.id, error: event.data.error }, 'Kernel reported timer failure');
      break;
    default:
      logger.warn({ event }, 'Unhandled timer event');
  }
};

const bootstrap = async () => {
  const eventSource = await createEventSource();
  const reporter = createKernelExecutionReporter();

  await eventSource.start((event) => handleEvent(event, reporter ?? undefined));

  const shutdown = async () => {
    logger.info('Shutting down action orchestrator');
    await eventSource.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

bootstrap().catch((error) => {
  logger.error({ error }, 'Failed to start action orchestrator');
  process.exit(1);
});
