import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { GrpcKernelGateway } from '../src/services/grpcKernelGateway';
import { TimerRecord } from '../src/types/timer';

const PROTO_PATH = join(__dirname, '../../../proto/timer.proto');

const loadProto = () => {
  const definition = protoLoader.loadSync(PROTO_PATH, {
    enums: String,
    longs: String,
    defaults: false,
    oneofs: true,
    keepCase: false,
  });
  return grpc.loadPackageDefinition(definition) as any;
};

type TimerProto = Record<string, unknown>;

describe('GrpcKernelGateway', () => {
  const timers = new Map<string, TimerProto>();
  let server: grpc.Server;
  let address: string;
  let proto: any;

  beforeAll(async () => {
    proto = loadProto();
    server = new grpc.Server();

    const serviceImplementation = {
      scheduleTimer(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
        const fireTime = call.request.fireTime ?? nowTimestamp();
        const id = call.request.clientTimerId || randomUUID();
        const timer: TimerProto = {
          id,
          tenantId: call.request.tenantId,
          requestedBy: call.request.requestedBy,
          name: call.request.name || 'scheduled-from-test',
          durationMs: Number(call.request.durationMs || '0'),
          createdAt: nowTimestamp(),
          fireAt: fireTime,
          metadata: call.request.metadata,
          labels: call.request.labels,
          status: 'TIMER_STATUS_SCHEDULED',
        };
        timers.set(`${timer.tenantId}:${id}`, timer);
        callback(null, { timer });
      },
      cancelTimer(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
        const key = `${call.request.tenantId}:${call.request.timerId}`;
        const timer = timers.get(key);
        if (!timer) {
          return callback({ code: grpc.status.NOT_FOUND } as grpc.ServiceError, null);
        }
        const cancelled = {
          ...timer,
          status: 'TIMER_STATUS_CANCELLED',
          cancelledAt: nowTimestamp(),
        };
        timers.set(key, cancelled);
        callback(null, cancelled);
      },
      getTimer(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
        const key = `${call.request.tenantId}:${call.request.timerId}`;
        const timer = timers.get(key);
        if (!timer) {
          return callback({ code: grpc.status.NOT_FOUND } as grpc.ServiceError, null);
        }
        callback(null, timer);
      },
      listTimers(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
        const list = Array.from(timers.values()).filter(
          (timer) => timer.tenantId === call.request.tenantId,
        );
        callback(null, { timers: list, nextPageToken: '' });
      },
    } satisfies Record<string, unknown>;

    const service = proto.minoots.timer.v1.HorologyKernel.service;
    server.addService(service, serviceImplementation);

    await new Promise<void>((resolve, reject) => {
      server.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err) {
            reject(err);
            return;
          }
          address = `127.0.0.1:${port}`;
          server.start();
          resolve();
        },
      );
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.tryShutdown(resolve));
  });

  const timerRecord = (): TimerRecord => ({
    id: randomUUID(),
    tenantId: 'tenant-1',
    requestedBy: 'agent-1',
    name: 'integration-test',
    durationMs: 5_000,
    createdAt: '2024-01-01T00:00:00.000Z',
    fireAt: '2024-01-01T00:00:05.000Z',
    status: 'scheduled',
    metadata: { foo: 'bar' },
    labels: { env: 'test' },
  });

  it('round-trips schedule responses through the gateway', async () => {
    const gateway = new GrpcKernelGateway(address, PROTO_PATH);
    const scheduled = await gateway.schedule(timerRecord());
    expect(scheduled?.tenantId).toBe('tenant-1');
    expect(scheduled?.metadata).toEqual({ foo: 'bar' });
  });

  it('lists timers from the gRPC service', async () => {
    const gateway = new GrpcKernelGateway(address, PROTO_PATH);
    await gateway.schedule(timerRecord());
    const timersForTenant = await gateway.list('tenant-1');
    expect(timersForTenant.length).toBeGreaterThan(0);
    expect(timersForTenant[0].tenantId).toBe('tenant-1');
  });
});

const nowTimestamp = () => {
  const millis = Date.now();
  const seconds = Math.floor(millis / 1000);
  return { seconds: seconds.toString(), nanos: (millis - seconds * 1000) * 1_000_000 };
};
