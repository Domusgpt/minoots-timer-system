import clsx from 'clsx';
import dayjs from 'dayjs';
import { useDashboard } from '../context/DashboardContext';

interface AnalyticsDashboardProps {
  compact?: boolean;
}

function AnalyticsDashboard({ compact }: AnalyticsDashboardProps) {
  const { analytics } = useDashboard();

  if (!analytics) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
        <p className="font-medium text-white">Analytics loading…</p>
        <p className="mt-2 text-xs">Connect to the API to hydrate operational insights.</p>
      </section>
    );
  }

  const chartPoints = analytics.trend.map((point, index) => ({
    index,
    timestamp: point.timestamp,
    completions: point.completions,
    failures: point.failures
  }));
  const maxValue = Math.max(...chartPoints.map((point) => point.completions + point.failures), 1);
  const denominator = Math.max(chartPoints.length - 1, 1);

  return (
    <section className={clsx('rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/60', compact ? 'h-full' : '')}>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Analytics</h2>
          <p className="text-sm text-slate-400">Outcome tracking for the last 12 hours.</p>
        </div>
        <div className="text-right text-xs text-slate-400">
          <p>Completion rate: <span className="font-semibold text-emerald-300">{Math.round(analytics.completionRate * 100)}%</span></p>
          <p>Failure rate: <span className="font-semibold text-rose-300">{Math.round(analytics.failureRate * 100)}%</span></p>
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Active" value={analytics.activeTimerCount} tone="emerald" description="Currently executing timers." />
        <Metric label="Median duration" value={`${Math.round(analytics.medianDurationSeconds / 60)} min`} tone="sky" description="Median execution runtime." />
        <Metric label="Completions/hr" value={averagePerHour(analytics.trend, 'completions')} tone="amber" description="Average completions per hour." />
      </div>

      {!compact && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Outcome trend</h3>
          <svg viewBox="0 0 400 160" className="mt-4 h-40 w-full">
            <polyline
              fill="none"
              strokeWidth={2}
              stroke="rgb(56, 189, 248)"
              strokeLinecap="round"
              points={chartPoints.map((point) => `${(point.index / denominator) * 400},${160 - (point.completions / maxValue) * 140 - 10}`).join(' ')}
            />
            <polyline
              fill="none"
              strokeWidth={2}
              stroke="rgb(248, 113, 113)"
              strokeLinecap="round"
              points={chartPoints.map((point) => `${(point.index / denominator) * 400},${160 - (point.failures / maxValue) * 140 - 10}`).join(' ')}
            />
          </svg>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
            {chartPoints.slice(0, 4).map((point) => (
              <div key={point.timestamp} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                <p className="font-semibold text-white">{dayjs(point.timestamp).format('HH:mm')}</p>
                <p>Completions: {point.completions}</p>
                <p>Failures: {point.failures}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone, description }: { label: string; value: string | number; tone: 'emerald' | 'sky' | 'amber'; description: string }) {
  const tones: Record<typeof tone, string> = {
    emerald: 'text-emerald-300',
    sky: 'text-sky-300',
    amber: 'text-amber-300'
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={clsx('mt-2 text-2xl font-semibold', tones[tone])}>{value}</p>
      <p className="text-xs text-slate-400">{description}</p>
    </div>
  );
}

function averagePerHour(trend: AnalyticsPoint[], field: 'completions' | 'failures' | 'pending') {
  const total = trend.reduce((acc, point) => acc + point[field], 0);
  return Math.round(total / trend.length);
}

type AnalyticsPoint = {
  timestamp: string;
  completions: number;
  failures: number;
  pending: number;
};

export default AnalyticsDashboard;
