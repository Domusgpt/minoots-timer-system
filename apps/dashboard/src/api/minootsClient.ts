import dayjs from 'dayjs';

export type TimerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export interface TimerSummary {
  id: string;
  name: string;
  status: TimerStatus;
  owner: string;
  durationSeconds: number;
  remainingSeconds: number;
  tags: string[];
  startedAt?: string;
  scheduledFor?: string;
  dependencyCount: number;
}

export interface TimerAnalyticsSummary {
  completionRate: number;
  medianDurationSeconds: number;
  activeTimerCount: number;
  failureRate: number;
  trend: Array<{ timestamp: string; completions: number; failures: number; pending: number }>;
}

export interface TeamSummary {
  id: string;
  name: string;
  members: Array<{ id: string; name: string; role: 'owner' | 'admin' | 'member' }>;
  pendingInvites: Array<{ email: string; invitedBy: string; invitedAt: string }>;
}

export interface BillingSummary {
  plan: 'free' | 'pro' | 'enterprise';
  renewalDate: string;
  paymentMethod: string;
  usage: {
    includedTimers: number;
    activeTimers: number;
    overageTimers: number;
    spendThisCycleUsd: number;
  };
  invoices: Array<{ id: string; amountUsd: number; status: 'paid' | 'open' | 'void'; issuedAt: string }>;
}

export interface IntegrationSummary {
  id: string;
  name: string;
  description: string;
  category: 'automation' | 'notifications' | 'devops' | 'ai';
  enabled: boolean;
  configuration?: Record<string, string | boolean | number>;
}

export interface TimerEvent {
  timerId: string;
  status: TimerStatus;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface MinootsClient {
  getTimers(): Promise<TimerSummary[]>;
  getTimerAnalytics(): Promise<TimerAnalyticsSummary>;
  getTeams(): Promise<TeamSummary[]>;
  getBilling(): Promise<BillingSummary>;
  getIntegrations(): Promise<IntegrationSummary[]>;
  createTimer(input: Partial<TimerSummary> & { name: string; durationSeconds: number; scheduledFor?: string }): Promise<TimerSummary>;
  updateIntegration(id: string, enabled: boolean): Promise<IntegrationSummary>;
  addInvite(teamId: string, email: string): Promise<void>;
  onTimerEvents(handler: (event: TimerEvent) => void): () => void;
}

class HttpMinootsClient implements MinootsClient {
  constructor(private readonly baseUrl: string) {}

  async getTimers(): Promise<TimerSummary[]> {
    return this.request('/timers');
  }

  async getTimerAnalytics(): Promise<TimerAnalyticsSummary> {
    return this.request('/analytics/timers');
  }

  async getTeams(): Promise<TeamSummary[]> {
    return this.request('/teams');
  }

  async getBilling(): Promise<BillingSummary> {
    return this.request('/billing/summary');
  }

  async getIntegrations(): Promise<IntegrationSummary[]> {
    return this.request('/integrations');
  }

  async createTimer(input: Partial<TimerSummary> & { name: string; durationSeconds: number; scheduledFor?: string }): Promise<TimerSummary> {
    return this.request('/timers', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  async updateIntegration(id: string, enabled: boolean): Promise<IntegrationSummary> {
    return this.request(`/integrations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled })
    });
  }

  async addInvite(teamId: string, email: string): Promise<void> {
    await this.request(`/teams/${teamId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  onTimerEvents(handler: (event: TimerEvent) => void): () => void {
    const url = `${this.baseUrl.replace(/\/$/, '')}/timers/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });
    eventSource.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as TimerEvent;
        handler(payload);
      } catch (error) {
        console.error('Failed to parse timer event', error);
      }
    };
    eventSource.onerror = (error) => {
      console.warn('Timer event stream error', error);
    };
    return () => eventSource.close();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      },
      credentials: 'include'
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Request failed (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }
}

class MockMinootsClient implements MinootsClient {
  private readonly timers: TimerSummary[] = Array.from({ length: 8 }).map((_, index) => {
    const status: TimerStatus[] = ['pending', 'running', 'completed', 'failed'];
    const chosenStatus = status[index % status.length];
    const duration = 300 + index * 120;
    const startedAt = dayjs().subtract(index * 5, 'minute').toISOString();
    return {
      id: `timer-${index + 1}`,
      name: `Demo Timer ${index + 1}`,
      status: chosenStatus,
      owner: index % 2 === 0 ? 'Automation Bus' : 'Ops Team',
      durationSeconds: duration,
      remainingSeconds: Math.max(0, duration - index * 40),
      tags: index % 2 === 0 ? ['agent', 'priority'] : ['ops'],
      startedAt,
      scheduledFor: dayjs(startedAt).add(5, 'minute').toISOString(),
      dependencyCount: index % 3
    } satisfies TimerSummary;
  });

  private readonly integrations: IntegrationSummary[] = [
    {
      id: 'slack',
      name: 'Slack',
      description: 'Send channel alerts when timers change state.',
      category: 'notifications',
      enabled: true,
      configuration: { channel: '#minoots-alerts' }
    },
    {
      id: 'stripe',
      name: 'Stripe Usage Sync',
      description: 'Push timer usage metrics to Stripe billing.',
      category: 'automation',
      enabled: true
    },
    {
      id: 'langchain',
      name: 'LangChain Agent',
      description: 'Allow LangChain agents to orchestrate timers.',
      category: 'ai',
      enabled: false
    },
    {
      id: 'pagerduty',
      name: 'PagerDuty Escalations',
      description: 'Trigger incidents when timers breach thresholds.',
      category: 'notifications',
      enabled: false
    }
  ];

  getTimers(): Promise<TimerSummary[]> {
    return Promise.resolve(this.clone(this.timers));
  }

  async getTimerAnalytics(): Promise<TimerAnalyticsSummary> {
    return {
      completionRate: 0.92,
      medianDurationSeconds: 480,
      activeTimerCount: this.timers.filter((timer) => timer.status === 'running').length,
      failureRate: 0.04,
      trend: Array.from({ length: 12 }).map((_, index) => {
        const timestamp = dayjs().subtract(index, 'hour').toISOString();
        return {
          timestamp,
          completions: 10 + index,
          failures: Math.max(0, 2 - index % 3),
          pending: 5 + (index % 4)
        };
      })
    } satisfies TimerAnalyticsSummary;
  }

  async getTeams(): Promise<TeamSummary[]> {
    return [
      {
        id: 'team-ops',
        name: 'Operations',
        members: [
          { id: 'user-1', name: 'Riley Chen', role: 'owner' },
          { id: 'user-2', name: 'Morgan Lee', role: 'admin' },
          { id: 'user-3', name: 'Deja Patel', role: 'member' }
        ],
        pendingInvites: [
          { email: 'alex@example.com', invitedBy: 'Riley Chen', invitedAt: dayjs().subtract(2, 'day').toISOString() }
        ]
      },
      {
        id: 'team-agents',
        name: 'Autonomous Agents',
        members: [
          { id: 'user-4', name: 'Timer Bot', role: 'admin' },
          { id: 'user-5', name: 'Atlas', role: 'member' }
        ],
        pendingInvites: []
      }
    ];
  }

  async getBilling(): Promise<BillingSummary> {
    return {
      plan: 'enterprise',
      renewalDate: dayjs().add(14, 'day').toISOString(),
      paymentMethod: 'Visa •• 4242',
      usage: {
        includedTimers: 25000,
        activeTimers: 18760,
        overageTimers: 120,
        spendThisCycleUsd: 1299.5
      },
      invoices: [
        { id: 'inv_001', amountUsd: 1180, status: 'paid', issuedAt: dayjs().subtract(30, 'day').toISOString() },
        { id: 'inv_002', amountUsd: 1235, status: 'paid', issuedAt: dayjs().subtract(60, 'day').toISOString() },
        { id: 'inv_003', amountUsd: 1299.5, status: 'open', issuedAt: dayjs().subtract(1, 'day').toISOString() }
      ]
    } satisfies BillingSummary;
  }

  async getIntegrations(): Promise<IntegrationSummary[]> {
    return this.clone(this.integrations);
  }

  async createTimer(input: Partial<TimerSummary> & { name: string; durationSeconds: number; scheduledFor?: string }): Promise<TimerSummary> {
    const timer: TimerSummary = {
      id: `timer-${this.timers.length + 1}`,
      name: input.name,
      status: 'pending',
      owner: input.owner ?? 'Dashboard',
      durationSeconds: input.durationSeconds,
      remainingSeconds: input.durationSeconds,
      tags: input.tags ?? [],
      dependencyCount: input.dependencyCount ?? 0,
      scheduledFor: input.scheduledFor ?? dayjs().toISOString()
    };
    this.timers.unshift(timer);
    return this.clone(timer);
  }

  async updateIntegration(id: string, enabled: boolean): Promise<IntegrationSummary> {
    const integration = this.integrations.find((item) => item.id === id);
    if (!integration) {
      throw new Error('Integration not found');
    }
    integration.enabled = enabled;
    return this.clone(integration);
  }

  async addInvite(teamId: string, email: string): Promise<void> {
    const team = (await this.getTeams()).find((t) => t.id === teamId);
    if (!team) {
      throw new Error('Team not found');
    }
    team.pendingInvites.push({ email, invitedBy: 'You', invitedAt: new Date().toISOString() });
  }

  onTimerEvents(handler: (event: TimerEvent) => void): () => void {
    const interval = setInterval(() => {
      const timer = this.timers[Math.floor(Math.random() * this.timers.length)];
      const statuses: TimerStatus[] = ['running', 'completed', 'failed'];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      timer.status = status;
      handler({ timerId: timer.id, status, payload: { name: timer.name }, occurredAt: new Date().toISOString() });
    }, 5000);

    return () => clearInterval(interval);
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }
}

export function createMinootsClient(): MinootsClient {
  const baseUrl = import.meta.env.VITE_MINOOTS_API_BASE as string | undefined;
  if (baseUrl) {
    return new HttpMinootsClient(baseUrl);
  }
  return new MockMinootsClient();
}

export type DashboardTimer = TimerSummary;
