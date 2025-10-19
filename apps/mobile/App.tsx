import { useEffect, useMemo, useState } from 'react';
import { FlatList, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Svg, Polyline } from 'react-native-svg';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

type MobileTimer = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  owner: string;
  durationSeconds: number;
  remainingSeconds: number;
};

type AnalyticsPoint = {
  timestamp: number;
  completions: number;
  failures: number;
};

const MOCK_TIMERS: MobileTimer[] = Array.from({ length: 6 }).map((_, index) => ({
  id: `timer-${index + 1}`,
  name: `Mobile Timer ${index + 1}`,
  status: index % 3 === 0 ? 'running' : index % 3 === 1 ? 'completed' : 'pending',
  owner: index % 2 === 0 ? 'Ops' : 'Agent',
  durationSeconds: 900,
  remainingSeconds: 900 - index * 60
}));

const MOCK_ANALYTICS: AnalyticsPoint[] = Array.from({ length: 8 }).map((_, index) => ({
  timestamp: Date.now() - index * 3600_000,
  completions: 10 + index,
  failures: Math.max(0, 3 - index)
}));

export default function App() {
  const [timers, setTimers] = useState<MobileTimer[]>(MOCK_TIMERS);
  const [analytics, setAnalytics] = useState<AnalyticsPoint[]>(MOCK_ANALYTICS);
  const [selectedTab, setSelectedTab] = useState<'timers' | 'analytics' | 'actions'>('timers');

  useEffect(() => {
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
  const percent = Math.round(((timer.durationSeconds - timer.remainingSeconds) / timer.durationSeconds) * 100);
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
  failed: { backgroundColor: '#f87171' }
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
