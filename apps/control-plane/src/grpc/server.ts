import path from 'node:path';

import grpc, { Metadata, Server, ServerCredentials } from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

import { Authenticator } from '../policy/authenticator';
import { QuotaExceededError } from '../policy/quotaManager';
import { AuthContext } from '../policy/types';
import { TimerService } from '../services/timerService';
import { timerCreateSchema } from '../types/timer';
import { logger } from '../telemetry/logger';

const loaderOptions: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const protoPath = path.resolve(__dirname, '../../../proto/timer.proto');
const packageDefinition = protoLoader.loadSync(protoPath, loaderOptions);
const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const horologyKernelService = descriptor?.minoots?.timer?.v1?.HorologyKernel?.service;

if (!horologyKernelService) {
  throw new Error('Failed to load HorologyKernel service from proto definition');
}

const loadKernelClient = () => {
  const KernelCtor = descriptor?.minoots?.timer?.v1?.HorologyKernel as any;
  const address = process.env.KERNEL_GRPC_URL || process.env.KERNEL_GRPC_ADDR || 'localhost:50051';
  return new KernelCtor(address, grpc.credentials.createInsecure());
};

const ensureRole = (context: AuthContext, role: string): void => {
  if (!context.roles.includes(role as any) && !context.roles.includes('tenant.admin')) {
    const error = new Error('Forbidden');
    (error as any).code = grpc.status.PERMISSION_DENIED;
    throw error;
  }
};

export interface GrpcGatewayHandle {
  server: Server;
  address: string;
  port: number;
  shutdown: () => Promise<void>;
  forceShutdown: () => void;
}

export const startGrpcGateway = async (
  timerService: TimerService,
  authenticator: Authenticator,
  address: string,
): Promise<GrpcGatewayHandle> => {
  const server = new grpc.Server();

  server.addService(horologyKernelService, {
    ScheduleTimer: async (call: any, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = await authenticateCall(authenticator, call.metadata, 'timer.write');
        const payload = normalizeScheduleRequest(call.request, context.tenantId);
        const timer = await timerService.createTimer(context, payload);
        callback(null, { timer: toProtoTimer(timer) });
      } catch (error) {
        callback(mapGrpcError(error));
      }
    },
    CancelTimer: async (call: any, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = await authenticateCall(authenticator, call.metadata, 'timer.cancel');
        const tenantId: string = call.request?.tenantId ?? context.tenantId;
        if (tenantId !== context.tenantId) {
          throw forbiddenError('Tenant mismatch');
        }
        const timer = await timerService.cancelTimer(context, call.request.timerId, {
          tenantId,
          requestedBy: call.request.requestedBy,
          reason: call.request.reason ?? undefined,
        });
        if (!timer) {
          const notFound = new Error('Timer not found');
          (notFound as any).code = grpc.status.NOT_FOUND;
          callback(notFound);
          return;
        }
        callback(null, toProtoTimer(timer));
      } catch (error) {
        callback(mapGrpcError(error));
      }
    },
    GetTimer: async (call: any, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = await authenticateCall(authenticator, call.metadata, 'timer.read');
        const tenantId: string = call.request?.tenantId ?? context.tenantId;
        if (tenantId !== context.tenantId) {
          throw forbiddenError('Tenant mismatch');
        }
        const timer = await timerService.getTimer(context, call.request.timerId);
        if (!timer) {
          const notFound = new Error('Timer not found');
          (notFound as any).code = grpc.status.NOT_FOUND;
          callback(notFound);
          return;
        }
        callback(null, toProtoTimer(timer));
      } catch (error) {
        callback(mapGrpcError(error));
      }
    },
    ListTimers: async (call: any, callback: grpc.sendUnaryData<any>) => {
      try {
        const context = await authenticateCall(authenticator, call.metadata, 'timer.read');
        const tenantId: string = call.request?.tenantId ?? context.tenantId;
        if (tenantId !== context.tenantId) {
          throw forbiddenError('Tenant mismatch');
        }
        const timers = await timerService.listTimers(context);
        callback(null, { timers: timers.map(toProtoTimer) });
      } catch (error) {
        callback(mapGrpcError(error));
      }
    },
    StreamTimerEvents: (call: grpc.ServerWritableStream<any, any>) => {
      (async () => {
        let stream: grpc.ClientReadableStream<any> | null = null;
        try {
          const context = await authenticateCall(authenticator, call.metadata, 'timer.read');
          const kernelClient = loadKernelClient();
          const metadata = new Metadata();
          const apiKey = call.metadata.get('x-api-key')[0];
          if (!apiKey || typeof apiKey !== 'string') {
            throw forbiddenError('x-api-key metadata is required');
          }
          metadata.set('x-api-key', apiKey);
          metadata.set('x-tenant-id', context.tenantId);
          if (context.traceId) {
            metadata.set('x-trace-id', context.traceId);
          }
          stream = kernelClient.streamTimerEvents(
            { tenantId: context.tenantId, topics: call.request?.topics ?? [] },
            metadata,
          );
          stream.on('data', (message: any) => {
            call.write(message);
          });
          stream.on('error', (error: any) => {
            logger.error({ error }, 'Kernel timer event stream error');
            call.destroy(mapGrpcError(error));
          });
          stream.on('end', () => {
            call.end();
          });
        } catch (error) {
          call.destroy(mapGrpcError(error));
          stream?.cancel();
        }
      })();
    },
  });

  const boundPort = await new Promise<number>((resolve, reject) => {
    server.bindAsync(address, ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(port);
    });
  });

  server.start();
  const boundAddress = address.includes(':') ? `${address.split(':')[0]}:${boundPort}` : `${address}:${boundPort}`;
  logger.info({ address: boundAddress }, 'Control plane gRPC gateway listening');

  const shutdown = async () =>
    new Promise<void>((resolve, reject) => {
      server.tryShutdown((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

  return {
    server,
    address: boundAddress,
    port: boundPort,
    shutdown,
    forceShutdown: () => server.forceShutdown(),
  };
};

const authenticateCall = async (
  authenticator: Authenticator,
  metadata: Metadata,
  requiredRole: string,
): Promise<AuthContext> => {
  const context = await authenticator.authenticateMetadata(metadata);
  if (!context) {
    const error = new Error('Unauthenticated');
    (error as any).code = grpc.status.UNAUTHENTICATED;
    throw error;
  }
  ensureRole(context, requiredRole);
  return context;
};

const normalizeScheduleRequest = (request: any, tenantId: string) => {
  const payload = {
    tenantId,
    requestedBy: request.requestedBy,
    name: request.name,
    duration: request.durationMs ?? request.duration_ms ?? request.scheduleTime?.durationMs,
    fireAt: request.fireTimeIso ?? request.fire_time_iso,
    metadata: parseJson(request.metadataJson),
    labels: request.labels ?? {},
    actionBundle: parseJson(request.actionBundleJson),
    agentBinding: parseJson(request.agentBindingJson),
  };
  return timerCreateSchema.parse(payload);
};

const toProtoTimer = (timer: any) => ({
  id: timer.id,
  tenantId: timer.tenantId,
  requestedBy: timer.requestedBy,
  name: timer.name,
  status: timer.status,
  createdAtIso: timer.createdAt,
  fireAtIso: timer.fireAt,
  firedAtIso: timer.firedAt ?? '',
  cancelledAtIso: timer.cancelledAt ?? '',
  cancelReason: timer.cancelReason ?? '',
  cancelledBy: timer.cancelledBy ?? '',
  durationMs: timer.durationMs,
  metadataJson: timer.metadata ? JSON.stringify(timer.metadata) : '',
  labels: timer.labels ?? {},
  actionBundleJson: timer.actionBundle ? JSON.stringify(timer.actionBundle) : '',
  agentBindingJson: timer.agentBinding ? JSON.stringify(timer.agentBinding) : '',
  settledAtIso: timer.settledAt ?? '',
  failureReason: timer.failureReason ?? '',
  stateVersion: timer.stateVersion ?? 0,
});

const parseJson = (value: unknown) => {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn({ error }, 'Failed to parse JSON payload from gRPC request');
      return undefined;
    }
  }
  if (typeof value === 'object') {
    return value;
  }
  return undefined;
};

const mapGrpcError = (error: any): grpc.ServiceError => {
  if (error instanceof QuotaExceededError) {
    const serviceError = new Error(error.message) as grpc.ServiceError;
    serviceError.code = grpc.status.RESOURCE_EXHAUSTED;
    return serviceError;
  }
  if ((error as any)?.code) {
    return error as grpc.ServiceError;
  }
  const serviceError = new Error('Internal error') as grpc.ServiceError;
  serviceError.code = grpc.status.INTERNAL;
  logger.error({ error }, 'Unhandled gRPC gateway error');
  return serviceError;
};

const forbiddenError = (message: string) => {
  const error = new Error(message) as grpc.ServiceError;
  error.code = grpc.status.PERMISSION_DENIED;
  return error;
};
