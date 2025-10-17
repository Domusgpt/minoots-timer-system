import { useState } from 'react';
import { BoltIcon, ChartBarIcon, Cog6ToothIcon, CreditCardIcon, HomeIcon, Squares2X2Icon, UserGroupIcon } from '@heroicons/react/24/outline';
import TimerMonitor from './components/TimerMonitor';
import TimerWizard from './components/TimerWizard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import TeamManagement from './components/TeamManagement';
import BillingManagement from './components/BillingManagement';
import IntegrationMarketplace from './components/IntegrationMarketplace';
import OperationsHub from './components/OperationsHub';

const tabs = [
  { id: 'overview', name: 'Overview', icon: HomeIcon },
  { id: 'timers', name: 'Timers', icon: BoltIcon },
  { id: 'analytics', name: 'Analytics', icon: ChartBarIcon },
  { id: 'teams', name: 'Teams', icon: UserGroupIcon },
  { id: 'billing', name: 'Billing', icon: CreditCardIcon },
  { id: 'integrations', name: 'Integrations', icon: Squares2X2Icon },
  { id: 'operations', name: 'Ops Center', icon: Cog6ToothIcon }
] as const;

function App() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('overview');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400">Minoots Phase 5</p>
            <h1 className="text-2xl font-semibold text-white">Autonomous Timer Control Center</h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-300">
            <div>
              <p className="text-xs uppercase text-slate-500">Environment</p>
              <p className="font-medium">{import.meta.env.VITE_MINOOTS_ENVIRONMENT ?? 'Sandbox'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Realtime Status</p>
              <TimerMonitor.StatusPill />
            </div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-2 px-6 pb-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition ${
                  isActive ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/30' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.name}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8">
        {activeTab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <TimerMonitor />
            <AnalyticsDashboard compact />
            <TimerWizard />
            <OperationsHub />
          </div>
        )}
        {activeTab === 'timers' && <TimerMonitor detailed />}
        {activeTab === 'analytics' && <AnalyticsDashboard />}
        {activeTab === 'teams' && <TeamManagement />}
        {activeTab === 'billing' && <BillingManagement />}
        {activeTab === 'integrations' && <IntegrationMarketplace />}
        {activeTab === 'operations' && <OperationsHub detailed />}
      </main>
    </div>
  );
}

export default App;
