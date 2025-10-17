import { createEventSource } from './infra/eventSource';
import { executeActions } from './actions';
import { logger } from './logger';
import { TimerEventEnvelope } from './types';
import { validateActionBundle } from './schema/registry';
import { actionAttempts, startMetricsServer } from './metrics';

const handleEvent = async (envelope: TimerEventEnvelope): Promise<void> => {
  const event = envelope.event;
  switch (event.type) {
    case 'scheduled':
      logger.debug({ timerId: event.data.id }, 'Timer scheduled');
      break;
    case 'fired':
      logger.info({ timerId: event.data.id }, 'Timer fired — executing actions');
      validateActionBundle(event.data.actionBundle);
      actionAttempts.inc({ action_kind: 'bundle', tenant_id: event.data.tenantId });
      await executeActions(event.data);
      break;
    case 'settled':
      logger.info({ timerId: event.data.id }, 'Timer settled');
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
  const metricsPort = parseInt(process.env.METRICS_PORT ?? '9095', 10);
  const metrics = startMetricsServer(metricsPort);

  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('Shutting down action orchestrator');
    await eventSource.stop();
    await metrics.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

bootstrap().catch((error) => {
  logger.error({ error }, 'Failed to start action orchestrator');
  process.exit(1);
});
