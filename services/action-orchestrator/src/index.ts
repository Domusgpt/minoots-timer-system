import { createEventSource } from './infra/eventSource';
import { executeActions } from './actions';
import { logger } from './logger';
import { TimerEvent } from './types';

const handleEvent = async (event: TimerEvent): Promise<void> => {
  switch (event.type) {
    case 'scheduled':
      logger.debug({ timerId: event.data.id }, 'Timer scheduled');
      break;
    case 'fired':
      logger.info({ timerId: event.data.id }, 'Timer fired — executing actions');
      await executeActions(event.data);
      break;
    case 'cancelled':
      logger.info({ timerId: event.data.timer.id, reason: event.data.reason }, 'Timer cancelled');
      break;
    default:
      logger.warn({ event }, 'Unhandled timer event');
  }
};

const bootstrap = async () => {
  const eventSource = await createEventSource();
  await eventSource.start(handleEvent);

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
