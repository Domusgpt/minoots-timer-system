import { TimerRecord } from '../types/timer';
import { getFieldValue, getFirestore } from './firebaseAdmin';

export interface UsageCheck {
  allowed: boolean;
  limit: number;
  remaining: number;
  tier: string;
  message?: string;
}

export interface UsageTracker {
  checkDailyLimit(userId: string, tier: string): Promise<UsageCheck>;
  trackTimerCreation(userId: string, timer: TimerRecord): Promise<void>;
}

const DEFAULT_LIMITS: Record<string, number> = {
  anonymous: 5,
  free: 25,
  pro: 250,
  team: 1000,
};

const collectionName = 'usage_daily';

export class FirestoreUsageTracker implements UsageTracker {
  constructor(private readonly limits: Record<string, number> = DEFAULT_LIMITS) {}

  private limitForTier(tier: string): number {
    return this.limits[tier] ?? this.limits.free ?? 25;
  }

  async checkDailyLimit(userId: string, tier: string): Promise<UsageCheck> {
    const limit = this.limitForTier(tier);
    const todayKey = buildTodayKey(userId);

    try {
      const db = getFirestore();
      const doc = await db.collection(collectionName).doc(todayKey).get();
      const data = doc.data() as { timers?: number } | undefined;
      const used = doc.exists ? data?.timers ?? 0 : 0;
      const remaining = Math.max(limit - used, 0);
      return {
        allowed: remaining > 0,
        limit,
        remaining,
        tier,
        message: remaining > 0 ? undefined : 'Daily timer limit reached',
      };
    } catch (error) {
      console.warn('Usage limit check failed, allowing request by default', error);
      return {
        allowed: true,
        limit,
        remaining: limit,
        tier,
      };
    }
  }

  async trackTimerCreation(userId: string, _timer: TimerRecord): Promise<void> {
    const todayKey = buildTodayKey(userId);

    try {
      const db = getFirestore();
      await db
        .collection(collectionName)
        .doc(todayKey)
        .set(
          {
            timers: getFieldValue().increment(1),
            lastCreatedAt: getFieldValue().serverTimestamp(),
          },
          { merge: true },
        );
    } catch (error) {
      console.warn('Failed to persist timer usage metrics', error);
    }
  }
}

export class InMemoryUsageTracker implements UsageTracker {
  private readonly counters = new Map<string, number>();
  constructor(private readonly limits: Record<string, number> = DEFAULT_LIMITS) {}

  private limitForTier(tier: string): number {
    return this.limits[tier] ?? this.limits.free ?? 25;
  }

  async checkDailyLimit(userId: string, tier: string): Promise<UsageCheck> {
    const key = buildTodayKey(userId);
    const limit = this.limitForTier(tier);
    const used = this.counters.get(key) ?? 0;
    const remaining = Math.max(limit - used, 0);
    return {
      allowed: remaining > 0,
      limit,
      remaining,
      tier,
      message: remaining > 0 ? undefined : 'Daily timer limit reached',
    };
  }

  async trackTimerCreation(userId: string, _timer: TimerRecord): Promise<void> {
    const key = buildTodayKey(userId);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
}

const buildTodayKey = (userId: string): string => {
  const today = new Date().toISOString().split('T')[0];
  return `${userId}:${today}`;
};

export const createUsageTracker = (backend: 'firestore' | 'memory' = 'firestore'): UsageTracker => {
  if (backend === 'memory') {
    return new InMemoryUsageTracker();
  }
  return new FirestoreUsageTracker();
};
