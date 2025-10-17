import { Fragment, useMemo, type ComponentType } from 'react';
import { BoltIcon, ClockIcon, PauseCircleIcon, PlayCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { useDashboard, useRelativeTime } from '../context/DashboardContext';
import type { DashboardTimer } from '../api/minootsClient';
import clsx from 'clsx';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface TimerMonitorProps {
  detailed?: boolean;
}

const statusMap: Record<DashboardTimer['status'], { label: string; className: string; icon: ComponentType<{ className?: string }> }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/30', icon: ClockIcon },
  running: { label: 'Running', className: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30', icon: PlayCircleIcon },
  completed: { label: 'Completed', className: 'bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/30', icon: BoltIcon },
  failed: { label: 'Failed', className: 'bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/40', icon: XCircleIcon },
  paused: { label: 'Paused', className: 'bg-slate-500/10 text-slate-300 ring-1 ring-inset ring-slate-500/30', icon: PauseCircleIcon }
};

function TimerMonitor({ detailed }: TimerMonitorProps) {
  const { timers, recentEvents, streamingConnected, analytics } = useDashboard();
  const highlightTimers = useMemo(() => timers.slice(0, detailed ? timers.length : 5), [timers, detailed]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/60">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{detailed ? 'Timer Operations Center' : 'Live Timers'}</h2>
          <p className="text-sm text-slate-400">Real-time visibility across autonomous workloads.</p>
        </div>
        <StatusPill streamingConnected={streamingConnected} />
      </header>
      <div className="space-y-3">
        {highlightTimers.map((timer) => (
          <TimerRow key={timer.id} timer={timer} detailed={detailed} />
        ))}
        {highlightTimers.length === 0 && <p className="text-sm text-slate-400">No timers available yet.</p>}
      </div>
      {detailed && (
        <Fragment>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <MetricCard label="Active" value={analytics?.activeTimerCount ?? 0} trend="up" />
            <MetricCard label="Completion" value={`${Math.round((analytics?.completionRate ?? 0) * 100)}%`} trend="stable" />
            <MetricCard label="Failure" value={`${Math.round((analytics?.failureRate ?? 0) * 100)}%`} trend="down" />
          </div>
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Recent Events</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {recentEvents.slice(0, 8).map((event) => {
                const definition = statusMap[event.status];
                const Icon = definition.icon;
                const label = typeof event.payload?.name === 'string' ? event.payload.name : event.timerId;
                return (
                  <li key={`${event.timerId}-${event.occurredAt}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', definition.className)}>
                        <Icon className="h-3.5 w-3.5" />
                        {definition.label}
                      </span>
                      <span className="font-medium text-white">{label}</span>
                    </div>
                    <span className="text-xs text-slate-400">{dayjs(event.occurredAt).format('HH:mm:ss')}</span>
                  </li>
                );
              })}
              {recentEvents.length === 0 && <li className="text-slate-500">Waiting for new events…</li>}
            </ul>
          </div>
        </Fragment>
      )}
    </section>
  );
}

function TimerRow({ timer, detailed }: { timer: DashboardTimer; detailed?: boolean }) {
  const status = statusMap[timer.status];
  const StatusIcon = status.icon;
  const startedAgo = useRelativeTime(timer.startedAt);
  const eta = useMemo(() => {
    if (!timer.startedAt || timer.status === 'completed') {
      return '—';
    }
    const remaining = Math.max(timer.remainingSeconds ?? 0, 0);
    return dayjs().add(remaining, 'second').fromNow(true);
  }, [timer.startedAt, timer.status, timer.remainingSeconds]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-brand-500/40 hover:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-500">{timer.owner}</p>
          <h3 className="text-base font-semibold text-white">{timer.name}</h3>
        </div>
        <span className={clsx('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold', status.className)}>
          <StatusIcon className="h-4 w-4" />
          {status.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span>Duration: {Math.round(timer.durationSeconds / 60)}m</span>
        <span>Remaining: {Math.max(0, Math.round((timer.remainingSeconds ?? 0) / 60))}m</span>
        <span>Started: {startedAgo}</span>
        <span>ETA: {eta}</span>
        {timer.dependencyCount > 0 && <span>Dependencies: {timer.dependencyCount}</span>}
      </div>
      {detailed && timer.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {timer.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: string | number; trend: 'up' | 'down' | 'stable' }) {
  const trendCopy: Record<typeof trend, string> = {
    up: '▲ Improving',
    down: '▼ Watchlist',
    stable: '■ Stable'
  };
  const trendClass: Record<typeof trend, string> = {
    up: 'text-emerald-300',
    down: 'text-rose-300',
    stable: 'text-slate-300'
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className={clsx('text-xs font-medium', trendClass[trend])}>{trendCopy[trend]}</p>
    </div>
  );
}

function StatusPill({ streamingConnected }: { streamingConnected: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
        streamingConnected ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40' : 'bg-slate-700/50 text-slate-300'
      )}
    >
      <span className={clsx('h-2.5 w-2.5 rounded-full', streamingConnected ? 'bg-emerald-300 animate-pulse' : 'bg-slate-500')} />
      {streamingConnected ? 'Streaming' : 'Offline'}
    </span>
  );
}

TimerMonitor.StatusPill = function TimerStatusPill() {
  const { streamingConnected } = useDashboard();
  return <StatusPill streamingConnected={streamingConnected} />;
};

export default TimerMonitor;
