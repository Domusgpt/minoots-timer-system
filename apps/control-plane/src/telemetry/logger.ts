import pino from 'pino';

export const logger = pino({
  name: 'minoots-control-plane',
  level: process.env.LOG_LEVEL ?? 'info',
});
