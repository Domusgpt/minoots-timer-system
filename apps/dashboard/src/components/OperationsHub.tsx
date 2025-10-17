import clsx from 'clsx';
import { useDashboard } from '../context/DashboardContext';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface OperationsHubProps {
  detailed?: boolean;
}

const playbooks = [
  {
    id: 'chain-unlock',
    name: 'Dependency Chain Unlock',
    description: 'Sequentially unlock timers as upstreams succeed with exponential backoff.',
    owner: 'Automation Guild',
    lastRunAt: dayjs().subtract(3, 'hour').toISOString()
  },
  {
    id: 'slo-watcher',
    name: 'SLO Breach Watcher',
    description: 'Escalate to PagerDuty when timers breach SLA thresholds.',
    owner: 'Reliability',
    lastRunAt: dayjs().subtract(45, 'minute').toISOString()
  }
];

const runbooks = [
  {
    id: 'freeze-rollback',
    name: 'Agent Freeze & Rollback',
    steps: ['Pause orchestrator timers', 'Snapshot Firestore state', 'Trigger rollback timers', 'Notify incident channel']
  },
  {
    id: 'refresh-keys',
    name: 'Rotate API Keys',
    steps: ['Generate secrets', 'Trigger rotation timers', 'Verify integration health']
  }
];

function OperationsHub({ detailed }: OperationsHubProps) {
  const { lastUpdatedAt, recentEvents } = useDashboard();
  const events = recentEvents.slice(0, detailed ? 12 : 5);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/60">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Operations Hub</h2>
          <p className="text-sm text-slate-400">Playbooks, runbooks, and live signals for operators.</p>
        </div>
        <p className="text-xs text-slate-500">Synced {lastUpdatedAt ? dayjs(lastUpdatedAt).fromNow() : '—'}</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Active Playbooks</h3>
          {playbooks.map((playbook) => (
            <div key={playbook.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm font-semibold text-white">{playbook.name}</p>
              <p className="text-xs text-slate-400">{playbook.description}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>Owner: {playbook.owner}</span>
                <span>Ran {dayjs(playbook.lastRunAt).fromNow()}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live Signals</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {events.map((event) => (
              <li key={`${event.timerId}-${event.occurredAt}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                <span className="font-medium text-white">{typeof event.payload?.name === 'string' ? event.payload.name : event.timerId}</span>
                <span className={clsx('rounded-full px-2 py-1 text-xs font-semibold uppercase', event.status === 'failed' ? 'bg-rose-500/10 text-rose-300' : event.status === 'completed' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-700/50 text-slate-300')}>
                  {event.status}
                </span>
              </li>
            ))}
            {events.length === 0 && <li className="text-xs text-slate-500">No events yet.</li>}
          </ul>
        </div>
      </div>
      {detailed && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {runbooks.map((runbook) => (
            <div key={runbook.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm font-semibold text-white">{runbook.name}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-400">
                {runbook.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default OperationsHub;
