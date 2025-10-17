import { EventEmitter } from 'node:events';

import { logger } from './logger';
import { TimerAction, TimerInstance } from './types';

export type AgentAdapter = 'mcp' | 'langchain' | 'autogen' | 'custom' | 'webhook';

export interface AgentCommand {
  adapter: AgentAdapter;
  target: string;
  payload: Record<string, unknown>;
  timer: TimerInstance;
  action: TimerAction;
}

export type AgentAckStatus = 'acknowledged' | 'rejected';

export interface AgentAck {
  status: AgentAckStatus;
  receivedAtIso: string;
  connector: string;
  metadata?: Record<string, unknown>;
}

export interface ProgressEvent {
  stage: 'dispatch' | 'progress' | 'ack';
  message: string;
  adapter: AgentAdapter;
  target: string;
  details?: Record<string, unknown>;
}

export interface AgentConnector {
  readonly id: string;
  supports(adapter: AgentAdapter): boolean;
  dispatch(command: AgentCommand, notify: (event: ProgressEvent) => void): Promise<AgentAck>;
}

export class AgentCommandBus extends EventEmitter {
  constructor(private readonly connectors: AgentConnector[]) {
    super();
  }

  async dispatch(command: AgentCommand): Promise<AgentAck> {
    const connector = this.connectors.find((candidate) => candidate.supports(command.adapter));
    if (!connector) {
      throw new Error(`No connector registered for adapter ${command.adapter}`);
    }

    const baseEvent: Omit<ProgressEvent, 'stage'> = {
      message: 'Dispatching agent command',
      adapter: command.adapter,
      target: command.target,
    };

    this.emit('progress', { ...baseEvent, stage: 'dispatch' });

    const ack = await connector.dispatch(command, (event) => this.emit('progress', event));

    this.emit('progress', {
      ...baseEvent,
      stage: 'ack',
      message: 'Agent acknowledgement received',
      details: ack.metadata,
    });

    return ack;
  }
}

class SimulatedConnector implements AgentConnector {
  constructor(private readonly adapter: AgentAdapter, private readonly description: string) {}

  get id(): string {
    return `${this.adapter}-connector`;
  }

  supports(adapter: AgentAdapter): boolean {
    return adapter === this.adapter;
  }

  async dispatch(command: AgentCommand, notify: (event: ProgressEvent) => void): Promise<AgentAck> {
    notify({
      stage: 'progress',
      adapter: command.adapter,
      target: command.target,
      message: `Routing command via ${this.description}`,
      details: { timerId: command.timer.id, actionId: command.action.id },
    });

    await delay(50);

    notify({
      stage: 'progress',
      adapter: command.adapter,
      target: command.target,
      message: 'Awaiting remote acknowledgement',
    });

    await delay(Math.random() * 150 + 50);

    return {
      status: 'acknowledged',
      receivedAtIso: new Date().toISOString(),
      connector: this.id,
      metadata: {
        correlationId: `${command.timer.id}:${command.action.id}`,
        adapter: this.adapter,
      },
    };
  }
}

class WebhookConnector extends SimulatedConnector {
  constructor() {
    super('webhook', 'Webhook v2 bridge');
  }
}

class McpConnector extends SimulatedConnector {
  constructor() {
    super('mcp', 'Model Context Protocol agent');
  }
}

class LangChainConnector extends SimulatedConnector {
  constructor() {
    super('langchain', 'LangChain action graph');
  }
}

class AutoGenConnector extends SimulatedConnector {
  constructor() {
    super('autogen', 'AutoGen swarm orchestrator');
  }
}

class CustomConnector extends SimulatedConnector {
  constructor() {
    super('custom', 'Custom command bus adapter');
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const createDefaultAgentCommandBus = (): AgentCommandBus => {
  const connectors: AgentConnector[] = [
    new McpConnector(),
    new LangChainConnector(),
    new AutoGenConnector(),
    new WebhookConnector(),
    new CustomConnector(),
  ];
  const bus = new AgentCommandBus(connectors);
  bus.on('progress', (event: ProgressEvent) => {
    logger.debug(
      {
        stage: event.stage,
        adapter: event.adapter,
        target: event.target,
        details: event.details,
      },
      'Agent command bus progress',
    );
  });
  return bus;
};
