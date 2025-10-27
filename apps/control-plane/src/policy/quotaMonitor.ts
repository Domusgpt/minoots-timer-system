import { AuthContext } from '../types/auth';

const WINDOW_MS = 60_000;

type RateTracker = {
  timestamps: number[];
};

const ensureTracker = (store: Map<string, RateTracker>, key: string): RateTracker => {
  let tracker = store.get(key);
  if (!tracker) {
    tracker = { timestamps: [] };
    store.set(key, tracker);
  }
  return tracker;
};

const prune = (tracker: RateTracker, now: number) => {
  const cutoff = now - WINDOW_MS;
  while (tracker.timestamps.length > 0 && tracker.timestamps[0] < cutoff) {
    tracker.timestamps.shift();
  }
};

export class QuotaExceededError extends Error {}

export class QuotaMonitor {
  private readonly scheduleTrackers = new Map<string, RateTracker>();
  private readonly cancelTrackers = new Map<string, RateTracker>();

  enforceScheduleQuota(context: AuthContext) {
    const tracker = ensureTracker(this.scheduleTrackers, context.keyId);
    const now = Date.now();
    prune(tracker, now);
    if (tracker.timestamps.length >= context.quotas.schedulePerMinute) {
      throw new QuotaExceededError('Schedule rate limit exceeded');
    }
    tracker.timestamps.push(now);
  }

  enforceCancelQuota(context: AuthContext) {
    const tracker = ensureTracker(this.cancelTrackers, context.keyId);
    const now = Date.now();
    prune(tracker, now);
    if (tracker.timestamps.length >= context.quotas.cancelPerMinute) {
      throw new QuotaExceededError('Cancel rate limit exceeded');
    }
    tracker.timestamps.push(now);
  }
}
