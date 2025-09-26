import axios from 'axios';
import { z } from 'zod';
import { ExecutionResult, TimerInstance, WebhookAction } from '../types';
import { logger } from '../logger';

const httpActionSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('POST'),
  headers: z.record(z.string()).default({}),
  body: z.any().optional(),
  timeoutMs: z.number().int().positive().default(10000),
});

export class HttpActionExecutor {
  async execute(action: WebhookAction, timer: TimerInstance): Promise<ExecutionResult> {
    const payload = httpActionSchema.parse(action.parameters ?? {});
    try {
      const response = await axios({
        url: payload.url,
        method: payload.method,
        headers: {
          ...payload.headers,
          'x-minoots-timer-id': timer.id,
          'x-minoots-tenant-id': timer.tenantId,
        },
        data: payload.body ?? {
          timer,
          event: action.kind,
        },
        timeout: payload.timeoutMs,
      });

      return {
        actionId: action.id,
        success: true,
        output: `HTTP ${response.status}`,
        metadata: {
          status: response.status,
          statusText: response.statusText,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown HTTP error executing timer action';
      logger.error({ actionId: action.id, timerId: timer.id, error: message }, 'HTTP action failed');
      return {
        actionId: action.id,
        success: false,
        output: message,
      };
    }
  }
}
