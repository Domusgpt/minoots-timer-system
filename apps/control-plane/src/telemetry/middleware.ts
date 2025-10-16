import { context, trace } from '@opentelemetry/api';
import pinoHttp from 'pino-http';
import { RequestHandler } from 'express';

import { logger } from './logger';

export const requestLogger = pinoHttp({
  logger,
  autoLogging: true,
  customProps: () => {
    const span = trace.getSpan(context.active());
    if (!span) {
      return {};
    }
    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  },
});

export const traceHeaderMiddleware: RequestHandler = (_req, res, next) => {
  const span = trace.getSpan(context.active());
  if (span) {
    const spanContext = span.spanContext();
    res.setHeader('x-trace-id', spanContext.traceId);
    res.setHeader('x-span-id', spanContext.spanId);
  }
  next();
};
