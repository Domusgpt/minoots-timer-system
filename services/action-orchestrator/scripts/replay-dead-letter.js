#!/usr/bin/env node
/* eslint-disable no-console */
const { connect, StringCodec, AckPolicy, DeliverPolicy } = require('nats');

const parseArgs = () => {
  const defaults = {
    mode: 'inspect',
    limit: 20,
    servers: process.env.NATS_JETSTREAM_URL || process.env.NATS_URL || 'nats://localhost:4222',
    stream: process.env.NATS_JETSTREAM_STREAM || 'MINOOTS_TIMER',
    subject: process.env.NATS_SUBJECT || 'minoots.timer.fired',
  };
  const args = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--mode':
        args.mode = value;
        i += 1;
        break;
      case '--limit':
        args.limit = Number.parseInt(value, 10);
        i += 1;
        break;
      case '--stream':
        args.stream = value;
        i += 1;
        break;
      case '--dlq-subject':
        args.dlqSubject = value;
        i += 1;
        break;
      case '--subject':
        args.subject = value;
        i += 1;
        break;
      case '--servers':
        args.servers = value;
        i += 1;
        break;
      default:
        break;
    }
  }
  args.dlqSubject =
    args.dlqSubject || process.env.NATS_DLQ_SUBJECT || `${args.subject}.dlq`;
  if (!['inspect', 'replay'].includes(args.mode)) {
    throw new Error(`Unsupported mode: ${args.mode}`);
  }
  if (!args.limit || Number.isNaN(args.limit) || args.limit <= 0) {
    args.limit = defaults.limit;
  }
  return args;
};

const codec = StringCodec();

const formatMessage = (payload, info) => ({
  sequence: info?.streamSequence,
  delivered: info?.deliverySequence,
  timestamp: info?.timestamp,
  eventType: payload?.event?.type,
  error: payload?.error,
});

const inspect = (payload, info) => {
  console.log(JSON.stringify(formatMessage(payload, info), null, 2));
};

const replay = async (payload, info, jetstream, subject) => {
  if (!payload?.event) {
    console.warn(
      `Skipping sequence ${info?.streamSequence ?? 'unknown'}: missing event payload`,
    );
    return;
  }
  await jetstream.publish(subject, codec.encode(JSON.stringify(payload.event)));
  console.log(
    `Replayed sequence ${info?.streamSequence ?? 'unknown'} to subject ${subject}`,
  );
};

const main = async () => {
  const config = parseArgs();
  const connection = await connect({ servers: config.servers });
  const jetstream = connection.jetstream();
  const subscription = await jetstream.pullSubscribe(config.dlqSubject, {
    stream: config.stream,
    config: {
      durable_name: `DLQ_REPLAY_${Date.now()}`,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subject: config.dlqSubject,
    },
  });

  let processed = 0;
  try {
    while (processed < config.limit) {
      const batchSize = Math.min(10, config.limit - processed);
      const messages = await subscription.fetch(batchSize, { expires: 1000 });
      let received = 0;
      for await (const message of messages) {
        received += 1;
        processed += 1;
        let payload;
        try {
          payload = JSON.parse(codec.decode(message.data));
        } catch (error) {
          console.error('Failed to decode DLQ message', error);
          message.term();
          continue;
        }
        const info = message.info;
        if (config.mode === 'replay') {
          try {
            await replay(payload, info, jetstream, config.subject);
          } catch (error) {
            console.error('Failed to replay DLQ message', error);
            message.term();
            continue;
          }
        } else {
          inspect(payload, info);
        }
        message.ack();
        if (processed >= config.limit) {
          break;
        }
      }
      if (received === 0) {
        break;
      }
    }
  } finally {
    await subscription.destroy();
    await connection.drain();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
