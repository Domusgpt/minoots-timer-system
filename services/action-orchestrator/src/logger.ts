import pino from 'pino';

export const logger = pino({
  name: 'minoots-action-orchestrator',
  level: process.env.LOG_LEVEL ?? 'info',
});
