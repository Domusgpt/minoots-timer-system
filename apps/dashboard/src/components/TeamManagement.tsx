import { FormEvent, useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
import { useDashboard } from '../context/DashboardContext';
import clsx from 'clsx';

function TeamManagement() {
  const { teams, sendInvite } = useDashboard();
  const [draftEmail, setDraftEmail] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string | null>(teams[0]?.id ?? null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!draftEmail || !selectedTeam) {
      return;
    }
    try {
      setStatus('sending');
      await sendInvite(selectedTeam, draftEmail);
      setStatus('sent');
      setDraftEmail('');
    } catch (error) {
      console.error(error);
      setStatus('error');
    } finally {
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/60">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Team Management</h2>
          <p className="text-sm text-slate-400">Roles, membership, and invitations across organizations.</p>
        </div>
        <select
          value={selectedTeam ?? ''}
          onChange={(event) => setSelectedTeam(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </header>

      {teams
        .filter((team) => team.id === selectedTeam)
        .map((team) => (
          <div key={team.id} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Members</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {team.members.map((member) => (
                    <li key={member.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                      <div>
                        <p className="font-medium text-white">{member.name}</p>
                        <p className="text-xs uppercase text-slate-500">{member.role}</p>
                      </div>
                      <span className={clsx('text-xs font-semibold uppercase', member.role === 'owner' ? 'text-emerald-300' : member.role === 'admin' ? 'text-sky-300' : 'text-slate-400')}>
                        {member.role}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Pending Invites</h3>
                {team.pendingInvites.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {team.pendingInvites.map((invite) => (
                      <li key={invite.email} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                        <div>
                          <p className="font-medium text-white">{invite.email}</p>
                          <p className="text-xs text-slate-500">Invited by {invite.invitedBy}</p>
                        </div>
                        <p className="text-xs text-slate-500">{dayjs(invite.invitedAt).fromNow()}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No pending invitations.</p>
                )}
              </div>
            </div>

            <form onSubmit={handleInvite} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Issue Invitation</h3>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  value={draftEmail}
                  onChange={(event) => setDraftEmail(event.target.value)}
                  type="email"
                  required
                  placeholder="agent@example.com"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={status === 'sending'}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-brand-400 disabled:opacity-60"
                >
                  {status === 'sending' ? 'Sending…' : 'Send invite'}
                </button>
              </div>
              {status === 'sent' && <p className="mt-2 text-xs text-emerald-300">Invitation dispatched.</p>}
              {status === 'error' && <p className="mt-2 text-xs text-rose-300">Failed to send invitation.</p>}
            </form>
          </div>
        ))}
    </section>
  );
}

export default TeamManagement;
