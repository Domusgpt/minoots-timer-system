import dayjs from 'dayjs';
import { useDashboard } from '../context/DashboardContext';
import clsx from 'clsx';

function BillingManagement() {
  const { billing } = useDashboard();

  if (!billing) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
        <p className="font-semibold text-white">Billing data unavailable.</p>
        <p className="mt-2 text-xs">Connect Stripe credentials or refresh the dashboard.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/60">
      <header className="mb-6 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Billing &amp; Subscription</h2>
          <p className="text-sm text-slate-400">Stripe-backed invoicing, usage, and payment methods.</p>
        </div>
        <div className="flex gap-3">
          <button className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-500">
            Update payment method
          </button>
          <button className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:bg-brand-400">
            Manage subscription
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Plan Overview</h3>
            <p className="mt-2 text-2xl font-semibold text-white capitalize">{billing.plan}</p>
            <p className="text-xs text-slate-400">Renews on {dayjs(billing.renewalDate).format('MMMM D, YYYY')}.</p>
            <p className="mt-2 text-xs text-slate-400">Payment method: {billing.paymentMethod}</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Usage</h3>
            <UsageBar label="Included timers" value={billing.usage.activeTimers} limit={billing.usage.includedTimers} tone="emerald" />
            <UsageBar label="Overage" value={billing.usage.overageTimers} limit={1000} tone="rose" />
            <p className="mt-2 text-xs text-slate-400">Spend this cycle: <span className="font-semibold text-white">${billing.usage.spendThisCycleUsd.toFixed(2)}</span></p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Invoices</h3>
          <table className="mt-3 w-full table-fixed text-sm text-slate-300">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="w-1/3 py-2">Invoice</th>
                <th className="w-1/3 py-2">Issued</th>
                <th className="w-1/3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {billing.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-2 font-medium text-white">{invoice.id}</td>
                  <td className="py-2 text-xs text-slate-400">{dayjs(invoice.issuedAt).format('MMM D, YYYY')}</td>
                  <td className="py-2 text-right">
                    <span className={clsx('rounded-full px-2 py-1 text-xs font-semibold', invoice.status === 'paid' ? 'bg-emerald-500/10 text-emerald-300' : invoice.status === 'open' ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-700/50 text-slate-200')}>
                      ${invoice.amountUsd.toFixed(2)} – {invoice.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function UsageBar({ label, value, limit, tone }: { label: string; value: number; limit: number; tone: 'emerald' | 'rose' }) {
  const percent = Math.min(100, Math.round((value / limit) * 100));
  const tones: Record<typeof tone, string> = {
    emerald: 'from-emerald-500 to-emerald-300',
    rose: 'from-rose-500 to-rose-300'
  };
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <p>{label}</p>
        <p>
          {value.toLocaleString()} / {limit.toLocaleString()}
        </p>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-800">
        <div className={clsx('h-full rounded-full bg-gradient-to-r', tones[tone])} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default BillingManagement;
