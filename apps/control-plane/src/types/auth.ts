export interface QuotaLimits {
  maxActiveTimers: number;
  schedulePerMinute: number;
  cancelPerMinute: number;
}

export interface AuthContext {
  tenantId: string;
  principalId: string;
  roles: string[];
  permissions: string[];
  keyId: string;
  quotas: QuotaLimits;
  traceId?: string;
  requestId: string;
}

export type Permission =
  | 'timers:create'
  | 'timers:read'
  | 'timers:cancel'
  | 'timers:stream';

export interface PolicyApiKey {
  keyId: string;
  hashedSecret: string;
  principalId: string;
  roles: string[];
  permissions: Permission[];
  quotas?: Partial<QuotaLimits>;
}

export interface TenantPolicy {
  tenantId: string;
  apiKeys: PolicyApiKey[];
  quotas?: Partial<QuotaLimits>;
}

export interface PolicyConfig {
  signingSecret: string;
  defaultQuotas: QuotaLimits;
  tenants: TenantPolicy[];
}
