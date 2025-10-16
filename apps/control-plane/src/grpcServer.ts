import path from 'node:path';
import { randomUUID } from 'node:crypto';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

import { TimerService } from './services/timerService';
import { PolicyEngine } from './policy/policyEngine';
import { QuotaMonitor } from './policy/quotaMonitor';
import { TimerCreateInput, TimerRecord } from './types/timer';
import { AuthContext } from './types/auth';
import { KernelGateway, TimerEventStreamCommand } from './services/kernelGateway';
import { logger } from './telemetry/logger';

const PROTO_PATH = path.resolve(__dirname, '../../proto/timer.proto');

interface GrpcServerDeps {
  timerService: TimerService;
  policyEngine: PolicyEngine;
  quotaMonitor: QuotaMonitor;
  kernelGateway: KernelGateway;
}

const loaderOptions: protoLoader.Options = {
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  keepCase: false,
};

export const startGrpcServer = async (
  deps: GrpcServerDeps,
  port = parseInt(process.env.CONTROL_PLANE_GRPC_PORT ?? '50071', 10),
): Promise<grpc.Server> => {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, loaderOptions);
  const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
  const service = descriptor?.minoots?.timer?.v1?.HorologyKernel;
  if (!service) {
    throw new Error('Failed to load HorologyKernel service definition for control plane gateway');
  }

  const server = new grpc.Server();
  server.addService(service.service, buildHandlers(deps));

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      },
    );
  });
  server.start();
  logger.info({ port }, 'Control plane gRPC gateway listening');
  return server;
};

const buildHandlers = (deps: GrpcServerDeps) => {
  const { timerService, policyEngine, quotaMonitor, kernelGateway } = deps;
  return {
    scheduleTimer: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = authorize(call.metadata, call.request?.tenantId, 'timers:create', policyEngine, quotaMonitor);
        const input = toTimerCreateInput(call.request);
        if (input.tenantId !== context.tenantId) {
          callback({ code: grpc.status.PERMISSION_DENIED, message: 'tenantId mismatch with credential' }, null);
          return;
        }
        const timer = await timerService.createTimer(context, input);
        callback(null, { timer: timerRecordToProto(timer) });
      } catch (error) {
        callback(normalizeGrpcError(error), null);
      }
    },
    cancelTimer: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = authorize(call.metadata, call.request?.tenantId, 'timers:cancel', policyEngine, quotaMonitor);
        if (!call.request?.timerId) {
          callback({ code: grpc.status.INVALID_ARGUMENT, message: 'timer_id is required' }, null);
          return;
        }
        const timer = await timerService.cancelTimer(
          context,
          call.request?.tenantId,
          call.request?.timerId,
          {
            tenantId: call.request?.tenantId,
            requestedBy: call.request?.requestedBy,
            reason: call.request?.reason || undefined,
          },
        );
        if (!timer) {
          callback({ code: grpc.status.NOT_FOUND, message: 'Timer not found' }, null);
          return;
        }
        callback(null, timerRecordToProto(timer));
      } catch (error) {
        callback(normalizeGrpcError(error), null);
      }
    },
    getTimer: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = authorize(call.metadata, call.request?.tenantId, 'timers:read', policyEngine, quotaMonitor, false);
        const tenantId = call.request?.tenantId ?? context.tenantId;
        if (tenantId !== context.tenantId) {
          callback({ code: grpc.status.PERMISSION_DENIED, message: 'Cross-tenant access is not permitted' }, null);
          return;
        }
        const timer = await timerService.getTimer(context, tenantId, call.request?.timerId);
        if (!timer) {
          callback({ code: grpc.status.NOT_FOUND, message: 'Timer not found' }, null);
          return;
        }
        callback(null, timerRecordToProto(timer));
      } catch (error) {
        callback(normalizeGrpcError(error), null);
      }
    },
    listTimers: async (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = authorize(call.metadata, call.request?.tenantId, 'timers:read', policyEngine, quotaMonitor, false);
        const tenantId = call.request?.tenantId ?? context.tenantId;
        if (tenantId !== context.tenantId) {
          callback({ code: grpc.status.PERMISSION_DENIED, message: 'Cross-tenant access is not permitted' }, null);
          return;
        }
        const timers = await timerService.listTimers(context, tenantId);
        callback(null, { timers: timers.map(timerRecordToProto), nextPageToken: '' });
      } catch (error) {
        callback(normalizeGrpcError(error), null);
      }
    },
    streamTimerEvents: (call: grpc.ServerWritableStream<any, any>) => {
      let context: AuthContext;
      try {
        context = authorize(call.metadata, call.request?.tenantId, 'timers:stream', policyEngine, quotaMonitor, false);
      } catch (error) {
        call.destroy(normalizeGrpcError(error));
        return;
      }
      const tenantId = call.request?.tenantId ?? context.tenantId;
      if (tenantId !== context.tenantId && tenantId !== '__all__') {
        call.destroy({ code: grpc.status.PERMISSION_DENIED, message: 'Cross-tenant stream is forbidden' } as any);
        return;
      }
      const command: TimerEventStreamCommand = {
        tenantId: tenantId === '__all__' ? '__all__' : context.tenantId,
        topics: call.request?.topics ?? [],
      };
      const stream = kernelGateway.streamEvents(command, context);
      stream.on('data', (event) => {
        call.write(event);
      });
      stream.on('error', (err) => {
        call.destroy(normalizeGrpcError(err));
      });
      stream.on('end', () => {
        call.end();
      });
      call.on('cancelled', () => {
        stream.cancel();
      });
    },
  };
};

const authorize = (
  metadata: grpc.Metadata,
  tenantFromRequest: string | undefined,
  permission: 'timers:create' | 'timers:read' | 'timers:cancel' | 'timers:stream',
  policyEngine: PolicyEngine,
  quotaMonitor: QuotaMonitor,
  enforceTenantMatch = true,
): AuthContext => {
  const apiKeyHeader = metadata.get('x-api-key')[0] ?? metadata.get('authorization')[0];
  const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined;
  const tenantHeaderValue = metadata.get('x-tenant-id')[0];
  const tenantHeader = typeof tenantHeaderValue === 'string' ? tenantHeaderValue : undefined;
  const tenantId = enforceTenantMatch ? tenantHeader ?? tenantFromRequest : tenantFromRequest ?? tenantHeader;
  if (!tenantId) {
    throw { code: grpc.status.PERMISSION_DENIED, message: 'Tenant metadata is required' };
  }
  const trace = metadata.get('x-trace-id')[0];
  const requestIdHeader = metadata.get('x-request-id')[0];
  const context = policyEngine.authorize({
    apiKey,
    bearerToken: apiKey,
    tenantId,
    requestId: typeof requestIdHeader === 'string' ? requestIdHeader : randomUUID(),
    traceId: typeof trace === 'string' ? trace : undefined,
  });
  policyEngine.ensurePermission(context, permission);
  if (permission === 'timers:create') {
    quotaMonitor.enforceScheduleQuota(context);
  }
  if (permission === 'timers:cancel') {
    quotaMonitor.enforceCancelQuota(context);
  }
  if (enforceTenantMatch && tenantFromRequest && tenantFromRequest !== context.tenantId) {
    throw { code: grpc.status.PERMISSION_DENIED, message: 'tenantId mismatch with credential' };
  }
  return context;
};

const toTimerCreateInput = (request: any): TimerCreateInput => {
  if (!request || typeof request !== 'object') {
    throw new Error('Invalid schedule request payload');
  }
  const scheduleTime = request.scheduleTime ?? {};
  return {
    tenantId: request.tenantId,
    requestedBy: request.requestedBy,
    name: request.name || undefined,
    duration: scheduleTime.durationMs ? Number(scheduleTime.durationMs) : undefined,
    fireAt: scheduleTime.fireTimeIso || undefined,
    metadata: parseJson(request.metadataJson),
    labels: request.labels || {},
    actionBundle: parseJson(request.actionBundleJson),
    agentBinding: parseJson(request.agentBindingJson),
  } as TimerCreateInput;
};

const timerRecordToProto = (timer: TimerRecord) => ({
  id: timer.id,
  tenantId: timer.tenantId,
  requestedBy: timer.requestedBy,
  name: timer.name,
  status: statusToProto(timer.status),
  createdAtIso: timer.createdAt,
  fireAtIso: timer.fireAt,
  firedAtIso: timer.firedAt ?? '',
  cancelledAtIso: timer.cancelledAt ?? '',
  cancelReason: timer.cancelReason ?? '',
  cancelledBy: timer.cancelledBy ?? '',
  durationMs: timer.durationMs,
  metadataJson: timer.metadata ? JSON.stringify(timer.metadata) : '',
  actionBundleJson: timer.actionBundle ? JSON.stringify(timer.actionBundle) : '',
  agentBindingJson: timer.agentBinding ? JSON.stringify(timer.agentBinding) : '',
  labels: timer.labels ?? {},
});

const statusToProto = (status: string): number => {
  switch (status) {
    case 'scheduled':
      return 1;
    case 'armed':
      return 2;
    case 'fired':
      return 3;
    case 'cancelled':
      return 4;
    case 'failed':
      return 5;
    default:
      return 0;
  }
};

const parseJson = (value?: string) => {
  if (!value || value.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    logger.warn({ error }, 'Failed to parse JSON payload from gRPC request');
    return undefined;
  }
};

const normalizeGrpcError = (error: any): grpc.ServiceError => {
  if (error?.code && error?.message) {
    return error as grpc.ServiceError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: grpc.status.INTERNAL, message } as grpc.ServiceError;
};
