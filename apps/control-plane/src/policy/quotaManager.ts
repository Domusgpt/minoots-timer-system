import { Pool } from 'pg';

import { logger } from '../telemetry/logger';
import { getPostgresPool } from '../store/postgresPool';
import {
  countActiveTimers,
  getQuotaForTenant,
  selectQuotaUsageForUpdate,
  updateQuotaUsage,
  withTenantQuotaTx,
} from '../store/tenantRepository';
import { AuthContext } from './types';

export class QuotaExceededError extends Error {
  constructor(public readonly limitType: 'daily' | 'burst', message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class QuotaManager {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getPostgresPool();
  }

  async enforceScheduleQuota(context: AuthContext): Promise<void> {
    const quota = await getQuotaForTenant(this.pool, context.tenantId);
    const today = new Date().toISOString().slice(0, 10);

    await withTenantQuotaTx(this.pool, async (client) => {
      const currentUsage = await selectQuotaUsageForUpdate(client, context.tenantId, today);
      if (currentUsage + 1 > quota.dailyTimerLimit) {
        throw new QuotaExceededError(
          'daily',
          `Tenant ${context.tenantId} exhausted daily quota of ${quota.dailyTimerLimit} timers`,
        );
      }

      const activeCount = await countActiveTimers(client, context.tenantId);
      if (activeCount + 1 > quota.burstTimerLimit) {
        throw new QuotaExceededError(
          'burst',
          `Tenant ${context.tenantId} exceeded burst quota of ${quota.burstTimerLimit} active timers`,
        );
      }

      await updateQuotaUsage(client, context.tenantId, today, currentUsage + 1);
      logger.debug(
        {
          tenantId: context.tenantId,
          principalId: context.principalId,
          scheduledToday: currentUsage + 1,
          activeTimers: activeCount,
        },
        'Updated tenant quota usage',
      );
    });
  }
}
