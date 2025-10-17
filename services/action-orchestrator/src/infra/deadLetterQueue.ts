import { JetStreamClient, StringCodec } from 'nats';

import { TimerEventEnvelope } from '../types';
import { logger } from '../logger';

const codec = StringCodec();

const toSerializableError = (error: unknown): Record<string, unknown> => {
  if (!error) {
    return {};
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === 'object') {
    return { ...error } as Record<string, unknown>;
  }
  return { message: String(error) };
};

export class DeadLetterQueue {
  constructor(private readonly js: JetStreamClient, private readonly subject: string) {}

  async publish(event: TimerEventEnvelope | null, error: unknown): Promise<void> {
    try {
      const payload = {
        occurredAt: new Date().toISOString(),
        event,
        error: toSerializableError(error),
      };
      await this.js.publish(this.subject, codec.encode(JSON.stringify(payload)));
    } catch (publishError) {
      logger.error({ publishError }, 'Failed to publish to dead-letter queue');
    }
  }
}
