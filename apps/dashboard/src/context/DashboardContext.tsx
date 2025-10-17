import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { produce } from 'immer';
import dayjs from 'dayjs';
import {
  BillingSummary,
  DashboardTimer,
  IntegrationSummary,
  TeamSummary,
  TimerAnalyticsSummary,
  TimerEvent,
  createMinootsClient
} from '../api/minootsClient';

interface DashboardState {
  timers: DashboardTimer[];
  analytics?: TimerAnalyticsSummary;
  teams: TeamSummary[];
  billing?: BillingSummary;
  integrations: IntegrationSummary[];
  lastUpdatedAt?: string;
  streamingConnected: boolean;
  recentEvents: TimerEvent[];
}

const client = createMinootsClient();

interface DashboardContextValue extends DashboardState {
  refresh(): Promise<void>;
  createTimer(input: { name: string; durationSeconds: number; tags?: string[]; dependencyCount?: number; scheduledFor?: string }): Promise<void>;
  toggleIntegration(id: string, enabled: boolean): Promise<void>;
  sendInvite(teamId: string, email: string): Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined);

export function DashboardProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<DashboardState>({
    timers: [],
    teams: [],
    integrations: [],
    streamingConnected: false,
    recentEvents: []
  });
  const streamStopRef = useRef<() => void>();

  const refresh = useCallback(async () => {
    const [timers, analytics, teams, billing, integrations] = await Promise.all([
      client.getTimers(),
      client.getTimerAnalytics(),
      client.getTeams(),
      client.getBilling(),
      client.getIntegrations()
    ]);

    setState((current) => ({
      ...current,
      timers,
      analytics,
      teams,
      billing,
      integrations,
      lastUpdatedAt: new Date().toISOString()
    }));
  }, []);

  const createTimer = useCallback<DashboardContextValue['createTimer']>(
    async ({ name, durationSeconds, tags, dependencyCount, scheduledFor }) => {
      const timer = await client.createTimer({ name, durationSeconds, tags, dependencyCount, scheduledFor });
      setState((current) =>
        produce(current, (draft) => {
          draft.timers.unshift(timer);
          draft.lastUpdatedAt = new Date().toISOString();
        })
      );
    },
    []
  );

  const toggleIntegration = useCallback<DashboardContextValue['toggleIntegration']>(
    async (id, enabled) => {
      const integration = await client.updateIntegration(id, enabled);
      setState((current) =>
        produce(current, (draft) => {
          const index = draft.integrations.findIndex((item) => item.id === integration.id);
          if (index >= 0) {
            draft.integrations[index] = integration;
          }
        })
      );
    },
    []
  );

  const sendInvite = useCallback<DashboardContextValue['sendInvite']>(
    async (teamId, email) => {
      await client.addInvite(teamId, email);
      setState((current) =>
        produce(current, (draft) => {
          const team = draft.teams.find((item) => item.id === teamId);
          if (team) {
            team.pendingInvites.push({ email, invitedBy: 'You', invitedAt: new Date().toISOString() });
          }
        })
      );
    },
    []
  );

  useEffect(() => {
    refresh().catch((error) => console.error('Failed initial dashboard refresh', error));
  }, [refresh]);

  useEffect(() => {
    streamStopRef.current?.();
    const stop = client.onTimerEvents((event) => {
      setState((current) =>
        produce(current, (draft) => {
          draft.streamingConnected = true;
          draft.recentEvents.unshift(event);
          draft.recentEvents = draft.recentEvents.slice(0, 20);
          const timer = draft.timers.find((item) => item.id === event.timerId);
          if (timer) {
            timer.status = event.status;
            if (event.status === 'completed') {
              timer.remainingSeconds = 0;
            }
          }
        })
      );
    });
    streamStopRef.current = stop;

    return () => {
      stop?.();
      setState((current) => ({ ...current, streamingConnected: false }));
    };
  }, []);

  useEffect(() => {
    if (!state.analytics) {
      return;
    }
    const refreshTimer = setInterval(() => {
      refresh().catch((error) => console.error('Failed periodic refresh', error));
    }, 60000);
    return () => clearInterval(refreshTimer);
  }, [refresh, state.analytics]);

  const value = useMemo<DashboardContextValue>(
    () => ({
      ...state,
      refresh,
      createTimer,
      toggleIntegration,
      sendInvite
    }),
    [state, refresh, createTimer, toggleIntegration, sendInvite]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}

export function useRelativeTime(timestamp?: string) {
  return useMemo(() => {
    if (!timestamp) {
      return '—';
    }
    const deltaMinutes = dayjs().diff(dayjs(timestamp), 'minute');
    if (deltaMinutes < 1) {
      return 'just now';
    }
    if (deltaMinutes < 60) {
      return `${deltaMinutes}m ago`;
    }
    const hours = Math.floor(deltaMinutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }, [timestamp]);
}
