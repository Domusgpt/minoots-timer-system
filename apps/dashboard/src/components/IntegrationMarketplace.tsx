import { Switch } from '@headlessui/react';
import clsx from 'clsx';
import { useDashboard } from '../context/DashboardContext';

const categoryLabels: Record<'automation' | 'notifications' | 'devops' | 'ai', string> = {
  automation: 'Automation',
  notifications: 'Notifications',
  devops: 'DevOps',
  ai: 'AI & Agents'
};

function IntegrationMarketplace() {
  const { integrations, toggleIntegration } = useDashboard();

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/60">
      <header className="mb-6">
        <h2 className="text-lg font-semibold text-white">Integration Marketplace</h2>
        <p className="text-sm text-slate-400">Connect ecosystems, event buses, and tooling with a toggle.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => (
          <article key={integration.id} className="flex h-full flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div>
              <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-1 text-xs uppercase tracking-wide text-slate-400">
                {categoryLabels[integration.category]}
              </span>
              <h3 className="mt-3 text-base font-semibold text-white">{integration.name}</h3>
              <p className="mt-1 text-sm text-slate-400">{integration.description}</p>
              {integration.configuration && (
                <dl className="mt-3 space-y-1 text-xs text-slate-400">
                  {Object.entries(integration.configuration).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt className="uppercase tracking-wide text-slate-500">{key}</dt>
                      <dd className="font-medium text-slate-200">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Switch
                checked={integration.enabled}
                onChange={(checked) => toggleIntegration(integration.id, checked)}
                className={clsx(
                  'relative inline-flex h-6 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-950',
                  integration.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    'inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200',
                    integration.enabled ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </Switch>
              <span className={clsx('text-xs font-semibold uppercase', integration.enabled ? 'text-emerald-300' : 'text-slate-500')}>
                {integration.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default IntegrationMarketplace;
