import type { Request } from 'express';

export type Role =
  | 'timer.read'
  | 'timer.write'
  | 'timer.cancel'
  | 'timer.manage'
  | 'tenant.admin';

export interface QuotaPolicy {
  dailyTimerLimit: number;
  burstTimerLimit: number;
}

export interface AuthContext {
  tenantId: string;
  principalId: string;
  roles: Role[];
  quota: QuotaPolicy;
  traceId?: string;
  apiKeyId?: string;
  preferredRegion?: string;
}

export interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
}
