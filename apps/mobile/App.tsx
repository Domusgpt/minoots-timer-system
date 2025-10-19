import { useEffect, useMemo, useState } from 'react';
import { FlatList, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Svg, Polyline } from 'react-native-svg';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

type MobileTimerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

type MobileTimer = {
  id: string;
  name: string;
  status: MobileTimerStatus;
  owner: string;
  durationSeconds: number;
  remainingSeconds: number;
};

type AnalyticsPoint = {
  timestamp: number;
  completions: number;
  failures: number;
};

const env: Record<string, string | undefined> =
  (typeof globalThis !== 'undefined' &&
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env) ||
  {};

const API_BASE = env.EXPO_PUBLIC_MINOOTS_API_BASE;
const API_KEY = env.EXPO_PUBLIC_MINOOTS_API_KEY;
const USING_LIVE_DATA = Boolean(API_BASE);
const LIVE_REFRESH_INTERVAL_MS = 45000;

const MOCK_STATUSES: MobileTimerStatus[] = ['running', 'completed', 'pending', 'failed', 'paused'];

const MOCK_TIMERS: MobileTimer[] = Array.from({ length: 6 }).map((_, index) => ({
  id: `timer-${index + 1}`,
  name: `Mobile Timer ${index + 1}`,
  status: MOCK_STATUSES[index % MOCK_STATUSES.length],
  owner: index % 2 === 0 ? 'Ops' : 'Agent',
  durationSeconds: 900,
  remainingSeconds: Math.max(0, 900 - index * 60)
}));

const MOCK_ANALYTICS: AnalyticsPoint[] = Array.from({ length: 8 }).map((_, index) => ({
  timestamp: Date.now() - index * 3600_000,
  completions: 10 + index,
  failures: Math.max(0, 3 - index)
}));

async function fetchJson<T>(path: string): Promise<T> {
  if (!API_BASE) {
    throw new Error('API base not configured');
  }
  const sanitizedBase = API_BASE.replace(/\/$/, '');
  const targetPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${sanitizedBase}${targetPath}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new Error('Failed to parse response JSON');
  }
}

function parseTimer(raw: unknown): MobileTimer | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const id = value.id ?? value.timerId ?? value.reference ?? value.uid;
  if (!id) {
    return null;
  }

  const statusRaw = typeof value.status === 'string' ? value.status.toLowerCase() : undefined;
  const allowedStatuses: MobileTimerStatus[] = ['pending', 'running', 'completed', 'failed', 'paused'];
  const status: MobileTimerStatus = allowedStatuses.includes(statusRaw as MobileTimerStatus)
    ? (statusRaw as MobileTimerStatus)
    : 'pending';

  const durationValue = Number(
    value.durationSeconds ?? value.duration ?? value.expectedDuration ?? value.originalDuration ?? 0
  );
  const elapsedValue = Number(value.elapsedSeconds ?? value.elapsed ?? 0);
  const remainingValue = Number(
    value.remainingSeconds ?? value.remaining ?? value.remainingDurationSeconds ?? Math.max(0, durationValue - elapsedValue)
  );

  return {
    id: String(id),
    name: typeof value.name === 'string' ? value.name : typeof value.title === 'string' ? value.title : `Timer ${id}`,
    status,
    owner:
      typeof value.owner === 'string'
        ? value.owner
        : typeof value.createdBy === 'string'
        ? value.createdBy
        : typeof value.agentId === 'string'
        ? value.agentId
        : 'Unknown',
    durationSeconds: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 0,
    remainingSeconds: Number.isFinite(remainingValue) && remainingValue >= 0 ? remainingValue : 0
  };
}

function extractTimers(payload: unknown): MobileTimer[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).timers)
    ? ((payload as Record<string, unknown>).timers as unknown[])
    : [];

  return source
    .map((entry) => parseTimer(entry))
    .filter((timer): timer is MobileTimer => timer !== null);
}

function extractAnalytics(payload: unknown): AnalyticsPoint[] {
  const source = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).trend)
    ? ((payload as Record<string, unknown>).trend as unknown[])
    : [];

  return source
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const value = entry as Record<string, unknown>;
      const timestampInput =
        typeof value.timestamp === 'string' || typeof value.timestamp === 'number'
          ? value.timestamp
          : typeof value.bucket === 'string' || typeof value.bucket === 'number'
          ? value.bucket
          : typeof value.date === 'string' || typeof value.date === 'number'
          ? value.date
          : Date.now();
      const timestamp = new Date(timestampInput).getTime();
      if (!Number.isFinite(timestamp)) {
        return null;
      }
      const completions = Number(value.completions ?? value.completed ?? value.success ?? 0);
      const failures = Number(value.failures ?? value.failed ?? value.errors ?? 0);
      return {
        timestamp,
        completions: Number.isFinite(completions) ? completions : 0,
        failures: Number.isFinite(failures) ? failures : 0
      } satisfies AnalyticsPoint;
    })
    .filter((point): point is AnalyticsPoint => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function describeRelativeTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return 'just now';
  }
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return 'just now';
  }
  if (deltaSeconds < 3600) {
    return `${Math.floor(deltaSeconds / 60)}m ago`;
  }
  if (deltaSeconds < 86400) {
    return `${Math.floor(deltaSeconds / 3600)}h ago`;
  }
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

export default function App() {
  const [timers, setTimers] = useState<MobileTimer[]>(USING_LIVE_DATA ? [] : MOCK_TIMERS);
  const [analytics, setAnalytics] = useState<AnalyticsPoint[]>(USING_LIVE_DATA ? [] : MOCK_ANALYTICS);
  const [selectedTab, setSelectedTab] = useState<'timers' | 'analytics' | 'actions'>('timers');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(USING_LIVE_DATA);

  useEffect(() => {
    if (USING_LIVE_DATA) {
      return;
    }
    const interval = setInterval(() => {
      setTimers((current) =>
        current.map((timer, index) => {
          if (index === 0) {
            const remaining = Math.max(0, timer.remainingSeconds - 15);
            return {
              ...timer,
              remainingSeconds: remaining,
              status: remaining === 0 ? 'completed' : 'running'
            };
          }
          return timer;
        })
      );
      setAnalytics((current) => {
        const [first, ...rest] = current;
        return [{ ...first, completions: first.completions + 1 }, ...rest];
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!USING_LIVE_DATA || !API_BASE) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        setIsSyncing(true);
        const [timerPayload, analyticsPayload] = await Promise.all([
          fetchJson<unknown>('/timers'),
          fetchJson<unknown>('/analytics/timers')
        ]);
        if (cancelled) {
          return;
        }
        setTimers(extractTimers(timerPayload));
        setAnalytics(extractAnalytics(analyticsPayload));
        setLastSyncedAt(new Date().toISOString());
        setSyncError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSyncError(error instanceof Error ? error.message : 'Unknown sync error');
      } finally {
        if (!cancelled) {
          setIsSyncing(false);
        }
      }
    };

    refresh();
    const interval = setInterval(refresh, LIVE_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const syncLabel = useMemo(() => {
    if (!USING_LIVE_DATA) {
      return 'Offline demo data';
    }
    if (syncError) {
      return `Sync error: ${syncError}`;
    }
    if (isSyncing && !lastSyncedAt) {
      return 'Connecting to live data…';
    }
    if (isSyncing) {
      return 'Refreshing live data…';
    }
    if (lastSyncedAt) {
      return `Live sync ${describeRelativeTime(lastSyncedAt)}`;
    }
    return 'Awaiting first sync…';
  }, [isSyncing, lastSyncedAt, syncError]);

  const chartPoints = useMemo(() => {
    const maxValue = Math.max(...analytics.map((point) => point.completions + point.failures), 1);
    const denominator = Math.max(analytics.length - 1, 1);
    return analytics.map((point, index) => ({
      x: (index / denominator) * 280,
      completionY: 140 - (point.completions / maxValue) * 120,
      failureY: 140 - (point.failures / maxValue) * 120
    }));
  }, [analytics]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ExpoStatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Minoots Mobile</Text>
        <Text style={styles.subtitle}>Phase 5 • Control in your pocket</Text>
        <Text
          style={[
            styles.syncStatus,
            syncError ? styles.syncStatusError : USING_LIVE_DATA ? styles.syncStatusLive : styles.syncStatusOffline
          ]}
        >
          {syncLabel}
        </Text>
      </View>
      <View style={styles.tabBar}>
        {(
          [
            { id: 'timers', label: 'Timers' },
            { id: 'analytics', label: 'Analytics' },
            { id: 'actions', label: 'Actions' }
          ] as const
        ).map((tab) => (
          <TouchableOpacity key={tab.id} style={[styles.tab, selectedTab === tab.id && styles.tabActive]} onPress={() => setSelectedTab(tab.id)}>
            <Text style={[styles.tabLabel, selectedTab === tab.id && styles.tabLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {selectedTab === 'timers' && (
        <FlatList
          data={timers}
          keyExtractor={(timer) => timer.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <TimerCard timer={item} />}
        />
      )}

      {selectedTab === 'analytics' && (
        <View style={styles.analyticsCard}>
          <Text style={styles.sectionTitle}>Last 8 hours</Text>
          <Svg height={160} width={300} style={styles.chart}>
            <Polyline
              points={chartPoints.map((point) => `${point.x},${point.completionY}`).join(' ')}
              stroke="#38bdf8"
              strokeWidth={3}
              fill="none"
            />
            <Polyline
              points={chartPoints.map((point) => `${point.x},${point.failureY}`).join(' ')}
              stroke="#f87171"
              strokeWidth={3}
              fill="none"
            />
          </Svg>
          <Text style={styles.analyticsSummary}>Completions trending upward. Failures remain contained.</Text>
        </View>
      )}

      {selectedTab === 'actions' && (
        <View style={styles.actionsCard}>
          <Text style={styles.sectionTitle}>Quick actions</Text>
          {['Launch timer', 'Pause orchestrator', 'Escalate to Slack', 'Open billing'].map((action) => (
            <TouchableOpacity key={action} style={styles.actionButton}>
              <Text style={styles.actionLabel}>{action}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

function TimerCard({ timer }: { timer: MobileTimer }) {
  const percent =
    timer.durationSeconds > 0
      ? Math.max(0, Math.min(100, Math.round(((timer.durationSeconds - timer.remainingSeconds) / timer.durationSeconds) * 100)))
      : 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardOwner}>{timer.owner}</Text>
        <Text style={[styles.statusPill, statusStyles[timer.status]]}>{timer.status.toUpperCase()}</Text>
      </View>
      <Text style={styles.cardTitle}>{timer.name}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` }]} />
      </View>
      <Text style={styles.cardMeta}>{Math.round(timer.remainingSeconds / 60)} minutes remaining</Text>
    </View>
  );
}

const statusStyles: Record<MobileTimer['status'], object> = {
  pending: { backgroundColor: '#475569' },
  running: { backgroundColor: '#10b981' },
  completed: { backgroundColor: '#38bdf8' },
  failed: { backgroundColor: '#f87171' },
  paused: { backgroundColor: '#facc15' }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a'
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 24
  },
  title: {
    color: 'white',
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    color: '#94a3b8',
    marginTop: 4
  },
  syncStatus: {
    marginTop: 6,
    fontSize: 12,
    color: '#cbd5f5'
  },
  syncStatusLive: {
    color: '#4ade80'
  },
  syncStatusOffline: {
    color: '#facc15'
  },
  syncStatusError: {
    color: '#f87171'
  },
  tabBar: {
    flexDirection: 'row',
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#1e293b'
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center'
  },
  tabActive: {
    backgroundColor: '#3b82f6'
  },
  tabLabel: {
    color: '#94a3b8',
    fontWeight: '600'
  },
  tabLabelActive: {
    color: 'white'
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    marginTop: 16
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardOwner: {
    color: '#cbd5f5',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  statusPill: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  cardTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12
  },
  progressTrack: {
    backgroundColor: '#1e293b',
    height: 6,
    borderRadius: 999,
    marginTop: 16
  },
  progressFill: {
    backgroundColor: '#3b82f6',
    height: 6,
    borderRadius: 999
  },
  cardMeta: {
    marginTop: 12,
    color: '#94a3b8',
    fontSize: 12
  },
  analyticsCard: {
    margin: 16,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center'
  },
  chart: {
    marginTop: 12
  },
  analyticsSummary: {
    color: '#94a3b8',
    marginTop: 16,
    textAlign: 'center'
  },
  sectionTitle: {
    color: '#cbd5f5',
    fontSize: 16,
    fontWeight: '600'
  },
  actionsCard: {
    margin: 16,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20
  },
  actionButton: {
    marginTop: 12,
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  actionLabel: {
    color: 'white',
    fontWeight: '600'
  }
});
