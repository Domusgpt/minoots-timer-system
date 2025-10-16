#!/usr/bin/env node
const { connect, StringCodec } = require('nats');

(async () => {
  const servers = process.env.NATS_URL || 'nats://localhost:4222';
  const streamName = process.env.NATS_JETSTREAM_STREAM || 'MINOOTS_TIMER';
  const subject = process.env.NATS_SUBJECT || 'minoots.timer.fired';
  const dlqSubject = process.env.NATS_DLQ_SUBJECT || 'MINOOTS_TIMER.dlq';

  const connection = await connect({ servers });
  const manager = await connection.jetstreamManager();

  try {
    await manager.streams.info(streamName);
  } catch (error) {
    await manager.streams.add({
      name: streamName,
      subjects: [subject, dlqSubject],
      retention: 'limits',
      storage: 'file',
      max_msgs_per_subject: -1,
    });
    console.log(`[ensure-jetstream] Created stream ${streamName}`);
  }

  const durable = process.env.NATS_JETSTREAM_CONSUMER || 'ACTION_ORCHESTRATOR';
  try {
    await manager.consumers.info(streamName, durable);
  } catch (error) {
    await manager.consumers.add(streamName, {
      durable_name: durable,
      ack_policy: 'explicit',
      deliver_policy: 'new',
      filter_subject: subject,
      replay_policy: 'instant',
      max_deliver: parseInt(process.env.NATS_MAX_DELIVER || '10', 10),
      ack_wait: 30000000000,
    });
    console.log(`[ensure-jetstream] Created consumer ${durable}`);
  }

  const js = connection.jetstream();
  await js.publish(dlqSubject, StringCodec().encode(JSON.stringify({ type: 'bootstrap', timestamp: new Date().toISOString() })));
  await connection.close();
})().catch((error) => {
  console.error('[ensure-jetstream] Failed to ensure JetStream resources', error);
  process.exitCode = 1;
});
