import path from 'node:path';

import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { v4 as uuid } from 'uuid';

import { TimerRepository } from '../store/timerRepository';
import { createTimerRepository } from '../store/createTimerRepository';
import { TimerRecord, TimerActionBundle, AgentBinding, TimerStatus } from '../types/timer';
import { readEcosystemFromMetadata } from '../types/ecosystem';
import { logger } from '../telemetry/logger';

const DEFAULT_GRPC_URL = 'localhost:50051';
const REGION_LABEL_KEY = 'minoots.io/region';

type GrpcKernelClient = grpc.Client & {
  scheduleTimer: grpc.handleUnaryCall<any, any>;
  cancelTimer: grpc.handleUnaryCall<any, any>;
  getTimer: grpc.handleUnaryCall<any, any>;
  listTimers: grpc.handleUnaryCall<any, any>;
  streamTimerEvents: grpc.handleServerStreamingCall<any, any>;
};

type KernelClientConstructor = new (address: string, credentials: grpc.ChannelCredentials) => GrpcKernelClient;

const loaderOptions: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

let kernelClientCtor: KernelClientConstructor | undefined;

const loadKernelClientCtor = (): KernelClientConstructor => {
  if (kernelClientCtor) {
    return kernelClientCtor;
  }
  const protoPath = path.resolve(__dirname, '../../../proto/timer.proto');
  const packageDefinition = protoLoader.loadSync(protoPath, loaderOptions);
  const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
  const ctor = descriptor?.minoots?.timer?.v1?.HorologyKernel;
  if (!ctor) {
    throw new Error('Failed to load HorologyKernel service definition from proto file');
  }
  kernelClientCtor = ctor as KernelClientConstructor;
  return kernelClientCtor;
};

export interface TimerScheduleCommand {
  tenantId: string;
  requestedBy: string;
  name: string;
  durationMs: number;
  fireAt: string;
  metadata?: Record<string, unknown>;
  labels?: Record<string, string>;
  actionBundle?: TimerActionBundle;
  agentBinding?: AgentBinding;
}

export interface TimerCancelCommand {
  tenantId: string;
  timerId: string;
  requestedBy: string;
  reason?: string;
}

export interface KernelGatewayContext {
  tenantId: string;
  principalId: string;
  traceId?: string;
  headers: Record<string, string>;
}

export type KernelTimerEvent =
  | { type: 'scheduled'; timer: TimerRecord }
  | { type: 'fired'; timer: TimerRecord }
  | { type: 'cancelled'; timer: TimerRecord; reason?: string }
  | { type: 'settled'; timer: TimerRecord };

export interface KernelTimerEventEnvelope {
  envelopeId: string;
  tenantId: string;
  occurredAtIso: string;
  dedupeKey: string;
  traceId?: string;
  signature: string;
  signatureVersion: string;
  eventType: KernelTimerEvent['type'];
  event: KernelTimerEvent;
}

export interface KernelEventStream extends AsyncIterable<KernelTimerEventEnvelope> {
  close(): void;
}

export interface KernelGateway {
  schedule(command: TimerScheduleCommand, context: KernelGatewayContext): Promise<TimerRecord>;
  cancel(command: TimerCancelCommand, context: KernelGatewayContext): Promise<TimerRecord | null>;
  list(tenantId: string, context: KernelGatewayContext): Promise<TimerRecord[]>;
  get(tenantId: string, timerId: string, context: KernelGatewayContext): Promise<TimerRecord | null>;
  streamEvents(tenantId: string, context: KernelGatewayContext): KernelEventStream;
}

export class KernelNotLeaderError extends Error {
  constructor(message = 'Timer kernel is not currently the cluster leader', public readonly retryAfterMs?: number) {
    super(message);
    this.name = 'KernelNotLeaderError';
  }
}

export class InMemoryKernelGateway implements KernelGateway {
  constructor(private readonly repository: TimerRepository = createTimerRepository()) {}

  async schedule(
    command: TimerScheduleCommand,
    _context: KernelGatewayContext,
  ): Promise<TimerRecord> {
    const metadata = cloneNullable(command.metadata);
    const labels = command.labels ? { ...command.labels } : {};
    const timer: TimerRecord = {
      id: uuid(),
      tenantId: command.tenantId,
      requestedBy: command.requestedBy,
      name: command.name,
      durationMs: command.durationMs,
      createdAt: new Date().toISOString(),
      fireAt: command.fireAt,
      status: 'scheduled',
      metadata,
      labels,
      actionBundle: cloneNullable(command.actionBundle),
      agentBinding: cloneNullable(command.agentBinding),
      ecosystem: readEcosystemFromMetadata(metadata),
    };
    return this.repository.save(timer);
  }

  async cancel(
    command: TimerCancelCommand,
    _context: KernelGatewayContext,
  ): Promise<TimerRecord | null> {
    const existing = await this.repository.findById(command.tenantId, command.timerId);
    if (!existing) {
      return null;
    }

    if (existing.status === 'cancelled' || existing.status === 'fired') {
      return existing;
    }

    const cancelled: TimerRecord = {
      ...existing,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelReason: command.reason,
      cancelledBy: command.requestedBy,
    };
    return this.repository.update(cancelled);
  }

  async list(tenantId: string, _context: KernelGatewayContext): Promise<TimerRecord[]> {
    return this.repository.list(tenantId);
  }

  async get(
    tenantId: string,
    timerId: string,
    _context: KernelGatewayContext,
  ): Promise<TimerRecord | null> {
    return this.repository.findById(tenantId, timerId);
  }

  streamEvents(_tenantId: string, _context: KernelGatewayContext): KernelEventStream {
    return createEmptyEventStream();
  }
}

export class GrpcKernelGateway implements KernelGateway {
  private readonly client: GrpcKernelClient;

  constructor(address: string) {
    const ClientCtor = loadKernelClientCtor();
    this.client = new ClientCtor(address, grpc.credentials.createInsecure());
  }

  async schedule(command: TimerScheduleCommand, context: KernelGatewayContext): Promise<TimerRecord> {
    const request = buildScheduleRequest(command);
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).scheduleTimer(
        request,
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(normalizeGrpcError('scheduleTimer', error));
            return;
          }
          resolve(mapTimer(response?.timer));
        },
      );
    });
  }

  async cancel(command: TimerCancelCommand, context: KernelGatewayContext): Promise<TimerRecord | null> {
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).cancelTimer(
        {
          tenantId: command.tenantId,
          timerId: command.timerId,
          requestedBy: command.requestedBy,
          reason: command.reason ?? '',
        },
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            if (isGrpcNotFound(error)) {
              resolve(null);
              return;
            }
            reject(normalizeGrpcError('cancelTimer', error));
            return;
          }
          resolve(mapTimer(response));
        },
      );
    });
  }

  async list(tenantId: string, context: KernelGatewayContext): Promise<TimerRecord[]> {
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).listTimers(
        { tenantId },
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(normalizeGrpcError('listTimers', error));
            return;
          }
          const timers: unknown[] = response?.timers ?? [];
          resolve(timers.map((timer) => mapTimer(timer)));
        },
      );
    });
  }

  async get(tenantId: string, timerId: string, context: KernelGatewayContext): Promise<TimerRecord | null> {
    const metadata = this.buildMetadata(context);
    return new Promise((resolve, reject) => {
      (this.client as any).getTimer(
        { tenantId, timerId },
        metadata,
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            if (isGrpcNotFound(error)) {
              resolve(null);
              return;
            }
            reject(normalizeGrpcError('getTimer', error));
            return;
          }
          resolve(mapTimer(response));
        },
      );
    });
  }

  private buildMetadata(context: KernelGatewayContext): grpc.Metadata {
    const metadata = new grpc.Metadata();
    Object.entries(context.headers).forEach(([key, value]) => {
      metadata.set(key, value);
    });
    if (context.traceId) {
      metadata.set('x-trace-id', context.traceId);
    }
    metadata.set('x-principal-id', context.principalId);
    metadata.set('x-tenant-id', context.tenantId);
    return metadata;
  }

  streamEvents(tenantId: string, context: KernelGatewayContext): KernelEventStream {
    const metadata = this.buildMetadata(context);
    const request = { tenantId };
    const stream = (this.client as any).streamTimerEvents(request, metadata);
    return createGrpcEventStream(stream);
  }
}

type RegionalTarget = {
  id: string;
  address: string;
  gateway: GrpcKernelGateway;
};

const REGION_HEADER_CANDIDATES = ['x-minoots-region', 'x-region', 'x-home-region'];
const FAILOVER_STATUS_CODES = new Set([
  grpc.status.UNAVAILABLE,
  grpc.status.ABORTED,
  grpc.status.CANCELLED,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.DATA_LOSS,
]);

export class MultiRegionKernelGateway implements KernelGateway {
  private readonly regionMap: Map<string, RegionalTarget>;
  private readonly defaultRegion: string;

  constructor(targets: RegionalTarget[], defaultRegion: string) {
    if (targets.length === 0) {
      throw new Error('At least one regional target is required for MultiRegionKernelGateway');
    }

    this.regionMap = new Map();
    targets.forEach((target) => {
      const sanitizedId = sanitizeRegionId(target.id);
      if (!sanitizedId) {
        logger.warn({ target }, 'Ignoring kernel region with empty identifier');
        return;
      }
      if (this.regionMap.has(sanitizedId)) {
        logger.warn({ region: sanitizedId, address: target.address }, 'Duplicate kernel region identifier detected; overriding previous entry');
      }
      this.regionMap.set(sanitizedId, { ...target, id: sanitizedId });
    });

    if (this.regionMap.size === 0) {
      throw new Error('MultiRegionKernelGateway could not resolve any valid region targets');
    }

    const normalizedDefault = sanitizeRegionId(defaultRegion);
    this.defaultRegion = normalizedDefault && this.regionMap.has(normalizedDefault)
      ? normalizedDefault
      : Array.from(this.regionMap.keys())[0];
  }

  async schedule(
    command: TimerScheduleCommand,
    context: KernelGatewayContext,
  ): Promise<TimerRecord> {
    const order = this.determineRegionOrder(command.labels, context.headers);
    return this.executeWithFailover('schedule', order, context, async (target, ctx) => {
      const enriched = this.enrichScheduleCommand(command, target.id);
      return target.gateway.schedule(enriched, ctx);
    });
  }

  async cancel(
    command: TimerCancelCommand,
    context: KernelGatewayContext,
  ): Promise<TimerRecord | null> {
    const order = this.determineRegionOrder(undefined, context.headers);
    let lastError: unknown;
    for (const regionId of order) {
      const target = this.regionMap.get(regionId);
      if (!target) {
        continue;
      }
      try {
        const result = await target.gateway.cancel(command, this.withRegionContext(context, regionId));
        if (result) {
          return result;
        }
      } catch (error) {
        if (!this.shouldFailover(error)) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        lastError = error;
        logger.warn(
          { region: regionId, operation: 'cancel', error },
          'Kernel region failed during cancel; attempting failover',
        );
      }
    }
    if (lastError) {
      throw lastError instanceof Error ? lastError : new Error('All kernel regions unavailable for cancel');
    }
    return null;
  }

  async list(tenantId: string, context: KernelGatewayContext): Promise<TimerRecord[]> {
    const order = this.determineRegionOrder(undefined, context.headers);
    return this.executeWithFailover('list', order, context, (target, ctx) =>
      target.gateway.list(tenantId, ctx),
    );
  }

  async get(
    tenantId: string,
    timerId: string,
    context: KernelGatewayContext,
  ): Promise<TimerRecord | null> {
    const order = this.determineRegionOrder(undefined, context.headers);
    let lastError: unknown;
    for (const regionId of order) {
      const target = this.regionMap.get(regionId);
      if (!target) {
        continue;
      }
      try {
        const result = await target.gateway.get(tenantId, timerId, this.withRegionContext(context, regionId));
        if (result) {
          return result;
        }
      } catch (error) {
        if (!this.shouldFailover(error)) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        lastError = error;
        logger.warn(
          { region: regionId, operation: 'get', error },
          'Kernel region failed during get; attempting failover',
        );
      }
    }
    if (lastError) {
      throw lastError instanceof Error ? lastError : new Error('All kernel regions unavailable for get');
    }
    return null;
  }

  streamEvents(tenantId: string, context: KernelGatewayContext): KernelEventStream {
    const order = this.determineRegionOrder(undefined, context.headers);
    const primaryRegionId = order.find((region) => this.regionMap.has(region)) ?? this.defaultRegion;
    const target = this.regionMap.get(primaryRegionId);
    if (!target) {
      throw new Error('No kernel regions available for streaming events');
    }
    logger.info({ region: primaryRegionId }, 'Subscribing to horology kernel event stream');
    return target.gateway.streamEvents(tenantId, this.withRegionContext(context, primaryRegionId));
  }

  private determineRegionOrder(
    labels: Record<string, string> | undefined,
    headers: Record<string, string>,
  ): string[] {
    const hints: (string | undefined)[] = [];
    if (labels && labels[REGION_LABEL_KEY]) {
      hints.push(labels[REGION_LABEL_KEY]);
    }
    for (const key of REGION_HEADER_CANDIDATES) {
      if (headers[key]) {
        hints.push(headers[key]);
        break;
      }
    }
    hints.push(this.defaultRegion);

    const ordered: string[] = [];
    hints.forEach((hint) => {
      const sanitized = sanitizeRegionId(hint);
      if (sanitized && this.regionMap.has(sanitized) && !ordered.includes(sanitized)) {
        ordered.push(sanitized);
      }
    });

    this.regionMap.forEach((_target, regionId) => {
      if (!ordered.includes(regionId)) {
        ordered.push(regionId);
      }
    });

    return ordered;
  }

  private enrichScheduleCommand(
    command: TimerScheduleCommand,
    regionId: string,
  ): TimerScheduleCommand {
    const labels = { ...(command.labels ?? {}) };
    labels[REGION_LABEL_KEY] = regionId;
    return { ...command, labels };
  }

  private withRegionContext(
    context: KernelGatewayContext,
    regionId: string,
  ): KernelGatewayContext {
    return {
      ...context,
      headers: { ...context.headers, 'x-minoots-region': regionId },
    };
  }

  private async executeWithFailover<T>(
    operation: string,
    order: string[],
    context: KernelGatewayContext,
    handler: (target: RegionalTarget, context: KernelGatewayContext) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (const regionId of order) {
      const target = this.regionMap.get(regionId);
      if (!target) {
        continue;
      }
      try {
        return await handler(target, this.withRegionContext(context, regionId));
      } catch (error) {
        if (!this.shouldFailover(error)) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        lastError = error;
        logger.warn(
          { region: regionId, operation, error },
          'Kernel region failed; attempting failover',
        );
      }
    }
    if (lastError) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`All kernel regions failed for ${operation}`);
    }
    throw new Error(`No kernel regions available for ${operation}`);
  }

  private shouldFailover(error: unknown): boolean {
    if (error instanceof KernelNotLeaderError) {
      return true;
    }
    const grpcError = error as grpc.ServiceError | undefined;
    if (grpcError && typeof grpcError.code === 'number') {
      return FAILOVER_STATUS_CODES.has(grpcError.code);
    }
    return false;
  }
}

export const createKernelGateway = (): KernelGateway => {
  const mode = process.env.KERNEL_GATEWAY_MODE ?? 'grpc';

  if (mode === 'memory') {
    logger.warn('Using in-memory kernel gateway (KERNEL_GATEWAY_MODE=memory)');
    return new InMemoryKernelGateway();
  }

  const regionSpec =
    process.env.KERNEL_REGION_TARGETS ??
    process.env.KERNEL_GRPC_REGIONS ??
    process.env.KERNEL_REGIONS ??
    process.env.KERNEL_GRPC_URLS ??
    '';

  const parsedRegions = parseRegionTargets(regionSpec);
  if (parsedRegions.length > 0) {
    const targets: RegionalTarget[] = parsedRegions.map((definition) => ({
      id: definition.id,
      address: definition.address,
      gateway: new GrpcKernelGateway(definition.address),
    }));
    if (targets.length > 1) {
      const primary = sanitizeRegionId(process.env.KERNEL_PRIMARY_REGION) ?? targets[0].id;
      logger.info(
        {
          regions: targets.map((target) => ({ id: target.id, address: target.address })),
          defaultRegion: primary,
        },
        'Initializing multi-region kernel gateway',
      );
      return new MultiRegionKernelGateway(targets, primary);
    }
    const [singleTarget] = targets;
    logger.info(
      { region: singleTarget.id, address: singleTarget.address },
      'Using single-region kernel gateway target from configuration',
    );
    return singleTarget.gateway;
  }

  const grpcUrl = process.env.KERNEL_GRPC_URL || process.env.KERNEL_GRPC_ADDR || DEFAULT_GRPC_URL;
  return new GrpcKernelGateway(grpcUrl);
};

type ParsedRegionDefinition = {
  id: string;
  address: string;
};

function sanitizeRegionId(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseRegionTargets(raw: string): ParsedRegionDefinition[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const candidates: ParsedRegionDefinition[] = [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      parsed.forEach((entry, index) => {
        if (typeof entry === 'string') {
          const address = entry.trim();
          if (address) {
            candidates.push({ id: `region-${index + 1}`, address });
          }
          return;
        }
        if (entry && typeof entry === 'object') {
          const id = sanitizeRegionId((entry as Record<string, unknown>).id as string | undefined);
          const address = sanitizeRegionId((entry as Record<string, unknown>).address as string | undefined);
          if (id && address) {
            candidates.push({ id, address });
          }
        }
      });
      if (candidates.length > 0) {
        return candidates;
      }
    } else if (parsed && typeof parsed === 'object') {
      Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
        const address = typeof value === 'string' ? value.trim() : undefined;
        const id = sanitizeRegionId(key);
        if (id && address) {
          candidates.push({ id, address });
        }
      });
      if (candidates.length > 0) {
        return candidates;
      }
    }
  } catch (error) {
    // Not JSON; fall through to delimiter parsing
  }

  const segments = trimmed
    .split(/[,\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const results: ParsedRegionDefinition[] = [];
  segments.forEach((segment, index) => {
    const [maybeId, maybeAddress] = segment.includes('=')
      ? segment.split('=', 2).map((part) => part.trim())
      : [undefined, segment];
    const address = sanitizeRegionId(maybeAddress ?? maybeId);
    if (!address) {
      logger.warn({ segment }, 'Ignoring invalid kernel region segment');
      return;
    }
    const id = sanitizeRegionId(maybeId) ?? `region-${index + 1}`;
    results.push({ id, address });
  });

  return results;
}

const createEmptyEventStream = (): KernelEventStream => ({
  async *[Symbol.asyncIterator]() {
    return;
  },
  close() {
    // no-op for tests and offline mode
  },
});

const buildScheduleRequest = (command: TimerScheduleCommand) => ({
  tenantId: command.tenantId,
  requestedBy: command.requestedBy,
  name: command.name,
  scheduleTime: { durationMs: command.durationMs },
  fireTimeIso: command.fireAt,
  metadataJson: command.metadata ? JSON.stringify(command.metadata) : '',
  labels: command.labels ?? {},
  actionBundleJson: command.actionBundle ? JSON.stringify(command.actionBundle) : '',
  agentBindingJson: command.agentBinding ? JSON.stringify(command.agentBinding) : '',
});

const mapTimer = (payload: any): TimerRecord => {
  if (!payload) {
    throw new Error('Kernel returned empty timer payload');
  }
  const metadata = parseJson(payload.metadataJson);
  const labels = convertStringMap(payload.labels);
  return {
    id: payload.id,
    tenantId: payload.tenantId,
    requestedBy: payload.requestedBy,
    name: payload.name,
    durationMs: Number(payload.durationMs ?? payload.duration_ms ?? 0),
    createdAt: payload.createdAtIso ?? payload.created_at_iso ?? new Date().toISOString(),
    fireAt: payload.fireAtIso ?? payload.fire_at_iso ?? new Date().toISOString(),
    status: mapStatus(payload.status),
    metadata,
    labels,
    actionBundle: parseJson(payload.actionBundleJson) as TimerActionBundle | undefined,
    agentBinding: parseJson(payload.agentBindingJson) as AgentBinding | undefined,
    ecosystem: readEcosystemFromMetadata(metadata),
    firedAt: optionalString(payload.firedAtIso),
    cancelledAt: optionalString(payload.cancelledAtIso),
    cancelReason: optionalString(payload.cancelReason),
    cancelledBy: optionalString(payload.cancelledBy),
    settledAt: optionalString(payload.settledAtIso),
    failureReason: optionalString(payload.failureReason),
    stateVersion: payload.stateVersion
      ? Number(payload.stateVersion)
      : payload.state_version !== undefined
        ? Number(payload.state_version)
        : undefined,
    jitterMs:
      payload.jitterMs !== undefined
        ? Number(payload.jitterMs)
        : payload.jitter_ms !== undefined
          ? Number(payload.jitter_ms)
          : undefined,
  };
};

const mapTimerEventEnvelope = (payload: any): KernelTimerEventEnvelope => {
  if (!payload) {
    throw new Error('Kernel stream returned empty event envelope payload');
  }
  const event = decodeTimerEvent(payload.event, payload.eventType);
  return {
    envelopeId: payload.envelopeId,
    tenantId: payload.tenantId,
    occurredAtIso: payload.occurredAtIso,
    dedupeKey: payload.dedupeKey,
    traceId: optionalString(payload.traceId),
    signature: payload.signature,
    signatureVersion: payload.signatureVersion,
    eventType: event.type,
    event,
  };
};

const decodeTimerEvent = (payload: any, explicitType?: string): KernelTimerEvent => {
  if (!payload) {
    throw new Error('Kernel stream returned empty event payload');
  }
  const scheduled = payload.scheduled ?? payload.Scheduled;
  if (scheduled) {
    return { type: 'scheduled', timer: mapTimer(extractTimerPayload(scheduled)) };
  }
  const fired = payload.fired ?? payload.Fired;
  if (fired) {
    return { type: 'fired', timer: mapTimer(extractTimerPayload(fired)) };
  }
  const cancelled = payload.cancelled ?? payload.Cancelled;
  if (cancelled) {
    return {
      type: 'cancelled',
      timer: mapTimer(extractTimerPayload(cancelled)),
      reason: optionalString(cancelled.reason),
    };
  }
  const settled = payload.settled ?? payload.Settled;
  if (settled) {
    return { type: 'settled', timer: mapTimer(extractTimerPayload(settled)) };
  }

  const discriminantSource = explicitType ?? payload.event;
  const discriminant = typeof discriminantSource === 'string' ? discriminantSource.toLowerCase() : undefined;
  if (discriminant) {
    const baseTimer = payload.timer ? mapTimer(payload.timer) : mapTimer(extractTimerPayload(payload));
    switch (discriminant) {
      case 'scheduled':
        return { type: 'scheduled', timer: baseTimer };
      case 'fired':
        return { type: 'fired', timer: baseTimer };
      case 'cancelled':
        return { type: 'cancelled', timer: baseTimer, reason: optionalString(payload.reason) };
      case 'settled':
        return { type: 'settled', timer: baseTimer };
      default:
        break;
    }
  }

  throw new Error('Unsupported kernel timer event payload shape');
};

const extractTimerPayload = (value: any): any => {
  if (!value) {
    return value;
  }
  if (value.timer) {
    return value.timer;
  }
  return value;
};

const mapStatus = (status: unknown): TimerStatus => {
  switch (status) {
    case 'scheduled':
    case 'armed':
    case 'fired':
    case 'cancelled':
    case 'failed':
    case 'settled':
      return status;
    default:
      return 'scheduled';
  }
};

const convertStringMap = (value: any): Record<string, string> | undefined => {
  if (!value) {
    return undefined;
  }
  return Object.entries(value).reduce<Record<string, string>>((acc, [key, val]) => {
    if (typeof val === 'string') {
      acc[key] = val;
    }
    return acc;
  }, {});
};

const parseJson = (value: unknown): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.length > 0) {
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn({ error }, 'Failed to parse JSON payload from kernel');
      return undefined;
    }
  }
  return undefined;
};

const optionalString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
};

const cloneNullable = <T>(value: T | undefined): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};

const normalizeGrpcError = (method: string, error: unknown): Error => {
  const serviceError = error as grpc.ServiceError | undefined;
  if (serviceError && typeof serviceError.code === 'number') {
    if (serviceError.code === grpc.status.FAILED_PRECONDITION) {
      const retryAfterHeader = serviceError.metadata?.get?.('retry-after-ms');
      const retryAfterMs = Array.isArray(retryAfterHeader)
        ? Number(retryAfterHeader[0]) || undefined
        : Number(retryAfterHeader) || undefined;
      return new KernelNotLeaderError(serviceError.details, retryAfterMs);
    }
    return serviceError;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(`Kernel gRPC call ${method} failed`);
};

const createGrpcEventStream = (stream: grpc.ClientReadableStream<any>): KernelEventStream => {
  let closed = false;
  let ended = false;
  let pending: (() => void) | null = null;
  let error: Error | null = null;
  const queue: KernelTimerEventEnvelope[] = [];

  const wake = () => {
    if (pending) {
      pending();
      pending = null;
    }
  };

  stream.on('data', (payload) => {
    try {
      queue.push(mapTimerEventEnvelope(payload));
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      logger.error({ error: errorObj }, 'Failed to decode timer event envelope from kernel stream');
    }
    wake();
  });

  stream.on('error', (err) => {
    if (!ended) {
      error = normalizeGrpcError('streamTimerEvents', err);
    }
    wake();
  });

  stream.on('end', () => {
    ended = true;
    wake();
  });

  const iterator = async function* (): AsyncGenerator<KernelTimerEventEnvelope> {
    try {
      while (true) {
        if (queue.length === 0) {
          if (error) {
            throw error;
          }
          if (ended) {
            return;
          }
          await new Promise<void>((resolve) => {
            pending = resolve;
          });
          continue;
        }
        const next = queue.shift();
        if (next) {
          yield next;
        }
      }
    } finally {
      if (!closed) {
        closed = true;
        stream.cancel();
      }
    }
  };

  return {
    async *[Symbol.asyncIterator]() {
      yield* iterator();
    },
    close() {
      if (!closed) {
        closed = true;
        stream.cancel();
      }
    },
  };
};

const isGrpcNotFound = (error: unknown): boolean => {
  return Boolean((error as grpc.ServiceError)?.code === grpc.status.NOT_FOUND);
};
