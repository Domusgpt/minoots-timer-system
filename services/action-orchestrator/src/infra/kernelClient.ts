import path from 'node:path';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

import { ExecutionSummary } from '../actions';
import { TimerInstance, TimerExecutionError } from '../types';
import { logger } from '../logger';

const loaderOptions: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

type KernelGrpcClient = grpc.Client & {
  reportTimerExecution: (request: any, callback: grpc.requestCallback<any>) => void;
};

type KernelClientCtor = new (address: string, credentials: grpc.ChannelCredentials) => KernelGrpcClient;

let cachedCtor: KernelClientCtor | null = null;

const loadClientCtor = (): KernelClientCtor => {
  if (cachedCtor) {
    return cachedCtor;
  }
  const protoPath = path.resolve(__dirname, '../../../proto/timer.proto');
  const packageDefinition = protoLoader.loadSync(protoPath, loaderOptions);
  const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
  const ctor = descriptor?.minoots?.timer?.v1?.HorologyKernel;
  if (!ctor) {
    throw new Error('Failed to load HorologyKernel gRPC definition for execution reporting');
  }
  cachedCtor = ctor as KernelClientCtor;
  return cachedCtor;
};

export interface KernelExecutionReporter {
  report(timer: TimerInstance, summary: ExecutionSummary): Promise<void>;
}

class GrpcExecutionReporter implements KernelExecutionReporter {
  private readonly client: KernelGrpcClient;

  constructor(address: string) {
    const Ctor = loadClientCtor();
    this.client = new Ctor(address, grpc.credentials.createInsecure());
  }

  async report(timer: TimerInstance, summary: ExecutionSummary): Promise<void> {
    const request = buildRequest(timer, summary);
    await new Promise<void>((resolve, reject) => {
      this.client.reportTimerExecution(request, (error) => {
        if (error) {
          reject(new Error(`reportTimerExecution failed: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }
}

export const createKernelExecutionReporter = (): KernelExecutionReporter | null => {
  const address = process.env.KERNEL_GRPC_URL || process.env.KERNEL_GRPC_ADDR;
  if (!address) {
    logger.warn('Kernel execution reporter disabled: KERNEL_GRPC_URL not configured');
    return null;
  }

  try {
    return new GrpcExecutionReporter(address);
  } catch (error) {
    logger.error({ error }, 'Failed to initialize gRPC kernel execution reporter');
    return null;
  }
};

const buildRequest = (timer: TimerInstance, summary: ExecutionSummary) => {
  const finalStatus = summary.success ? 'TIMER_STATUS_FIRED' : 'TIMER_STATUS_FAILED';
  return {
    tenantId: timer.tenantId,
    timerId: timer.id,
    finalStatus,
    result: buildResult(summary),
    error: summary.error ? buildError(summary.error) : undefined,
  };
};

const buildResult = (summary: ExecutionSummary) => {
  return {
    actions: summary.results.map((result) => ({
      actionId: result.actionId,
      success: result.success,
      output: result.output ?? '',
      metadataJson: serializeJson(result.metadata),
    })),
    completedAtIso: summary.completedAtIso,
  };
};

const buildError = (error: TimerExecutionError) => ({
  message: error.message,
  code: error.code ?? '',
  metadataJson: serializeJson(error.metadata),
});

type Serializable = Record<string, unknown> | undefined;

const serializeJson = (value: Serializable): string => {
  if (!value) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    logger.error({ error }, 'Failed to serialize execution payload to JSON');
    return '';
  }
};
