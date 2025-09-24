import { connect, NatsConnection, StringCodec, Subscription } from 'nats';
import readline from 'node:readline';
import { z } from 'zod';
import { logger } from '../logger';
import { TimerEvent } from '../types';

const timerInstanceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  requestedBy: z.string(),
  status: z.enum(['scheduled', 'armed', 'fired', 'cancelled']),
  fireAt: z.string(),
  createdAt: z.string(),
  durationMs: z.number(),
  metadata: z.record(z.any()).optional(),
  labels: z.record(z.string()).optional(),
  actionBundle: z
    .object({
      actions: z
        .array(
          z.object({
            id: z.string(),
            kind: z.string(),
            parameters: z.record(z.any()).default({}),
          }),
        )
        .default([]),
      concurrency: z.number().optional(),
    })
    .optional(),
  firedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelReason: z.string().optional(),
  cancelledBy: z.string().optional(),
});

const timerEventSchema: z.ZodType<TimerEvent> = z.union([
  z.object({
    type: z.literal('scheduled'),
    data: timerInstanceSchema,
  }) as z.ZodType<TimerEvent>,
  z.object({
    type: z.literal('fired'),
    data: timerInstanceSchema,
  }) as z.ZodType<TimerEvent>,
  z.object({
    type: z.literal('cancelled'),
    data: z.object({ timer: timerInstanceSchema, reason: z.string().optional() }),
  }) as z.ZodType<TimerEvent>,
]);

type EventHandler = (event: TimerEvent) => Promise<void>;

export interface EventSource {
  start(handler: EventHandler): Promise<void>;
  stop(): Promise<void>;
}

export class NatsEventSource implements EventSource {
  private connection?: NatsConnection;
  private subscription?: Subscription;
  private readonly subject: string;

  constructor(private readonly servers: string, subject?: string) {
    this.subject = subject ?? 'minoots.timer.fired';
  }

  async start(handler: EventHandler): Promise<void> {
    this.connection = await connect({ servers: this.servers });
    const codec = StringCodec();
    this.subscription = this.connection.subscribe(this.subject);
    logger.info({ subject: this.subject }, 'Connected to NATS for timer events');

    (async () => {
      for await (const message of this.subscription!) {
        try {
          const decoded = codec.decode(message.data);
          const parsed = timerEventSchema.parse(JSON.parse(decoded));
          await handler(parsed);
        } catch (error) {
          logger.error({ error }, 'Failed to process NATS timer event');
        }
      }
    })();
  }

  async stop(): Promise<void> {
    await this.subscription?.drain();
    await this.connection?.drain();
  }
}

export class StdInEventSource implements EventSource {
  private rl?: readline.Interface;

  async start(handler: EventHandler): Promise<void> {
    this.rl = readline.createInterface({ input: process.stdin });
    logger.info('Reading timer events from STDIN (JSON per line)');
    this.rl.on('line', async (line) => {
      try {
        const parsed = timerEventSchema.parse(JSON.parse(line));
        await handler(parsed);
      } catch (error) {
        logger.error({ error, line }, 'Failed to process STDIN timer event');
      }
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}

export const createEventSource = async (): Promise<EventSource> => {
  const servers = process.env.NATS_URL;
  if (servers) {
    return new NatsEventSource(servers, process.env.NATS_SUBJECT);
  }
  return new StdInEventSource();
};
