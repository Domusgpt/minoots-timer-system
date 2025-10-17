import crypto from 'node:crypto';

import { logger } from '../logger';
import { TimerInstance } from '../types';

export interface AgentProgressUpdate {
  stage: string;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCommandRequest {
  adapter: string;
  target: string;
  payload: Record<string, unknown>;
  timer: TimerInstance;
  onProgress?: (update: AgentProgressUpdate) => void;
}

export interface AgentCommandAck {
  connector: string;
  status: 'accepted' | 'rejected';
  referenceId: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCommandResponse extends AgentCommandAck {
  progress: AgentProgressUpdate[];
}

interface AgentCommandConnector {
  name: string;
  supports(adapter: string): boolean;
  dispatch(request: AgentCommandRequest): Promise<AgentCommandResponse>;
}

export class AgentCommandBus {
  constructor(private readonly connectors: AgentCommandConnector[]) {}

  async dispatch(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    const connector = this.connectors.find((candidate) => candidate.supports(request.adapter));
    if (!connector) {
      throw new Error(`No agent command connector available for adapter ${request.adapter}`);
    }
    logger.info(
      { adapter: request.adapter, target: request.target, timerId: request.timer.id, connector: connector.name },
      'Dispatching agent command via connector',
    );
    const response = await connector.dispatch(request);
    response.progress.forEach((update) => request.onProgress?.(update));
    logger.info(
      {
        adapter: request.adapter,
        target: request.target,
        timerId: request.timer.id,
        connector: response.connector,
        status: response.status,
        referenceId: response.referenceId,
      },
      'Agent command completed',
    );
    return response;
  }
}

const nowIso = () => new Date().toISOString();

class BaseConnector implements AgentCommandConnector {
  public readonly name: string;

  constructor(protected readonly adapter: string, connectorName: string) {
    this.name = connectorName;
  }

  supports(adapter: string): boolean {
    return adapter === this.adapter;
  }

  protected recordProgress(
    request: AgentCommandRequest,
    updates: AgentProgressUpdate[],
    stage: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    const update: AgentProgressUpdate = {
      stage,
      message,
      timestamp: nowIso(),
      metadata,
    };
    updates.push(update);
    request.onProgress?.(update);
  }

  protected buildResponse(
    request: AgentCommandRequest,
    updates: AgentProgressUpdate[],
    metadata?: Record<string, unknown>,
  ): AgentCommandResponse {
    return {
      connector: this.name,
      status: 'accepted',
      referenceId: crypto.randomUUID(),
      metadata: {
        target: request.target,
        adapter: request.adapter,
        ...(metadata ?? {}),
      },
      progress: updates,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async dispatch(_request: AgentCommandRequest): Promise<AgentCommandResponse> {
    throw new Error('dispatch must be implemented by subclasses');
  }
}

class McpConnector extends BaseConnector {
  constructor() {
    super('mcp', 'mcp');
  }

  async dispatch(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    const progress: AgentProgressUpdate[] = [];
    this.recordProgress(request, progress, 'handshake', 'Established MCP session');
    this.recordProgress(request, progress, 'deliver', 'Forwarded command payload to MCP agent', {
      payloadKeys: Object.keys(request.payload),
    });
    this.recordProgress(request, progress, 'await_ack', 'Awaiting MCP acknowledgement');
    return this.buildResponse(request, progress, { channel: 'mcp', mode: 'session' });
  }
}

class LangChainConnector extends BaseConnector {
  constructor() {
    super('langchain', 'langchain');
  }

  async dispatch(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    const progress: AgentProgressUpdate[] = [];
    this.recordProgress(request, progress, 'prepare', 'Composing LangChain runnable graph');
    this.recordProgress(request, progress, 'execute', 'Dispatching runnable to orchestration cluster', {
      payloadPreview: Object.keys(request.payload),
    });
    this.recordProgress(request, progress, 'await_callback', 'Waiting for LangChain completion callback');
    return this.buildResponse(request, progress, { cluster: 'langchain', workflow: request.target });
  }
}

class AutoGenConnector extends BaseConnector {
  constructor() {
    super('autogen', 'autogen');
  }

  async dispatch(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    const progress: AgentProgressUpdate[] = [];
    this.recordProgress(request, progress, 'enqueue', 'Queued command with AutoGen orchestrator');
    this.recordProgress(request, progress, 'coordination', 'Negotiating agent swarm roles');
    return this.buildResponse(request, progress, { swarmSize: request.payload?.participants ?? 1 });
  }
}

class WebhookConnector extends BaseConnector {
  constructor() {
    super('custom', 'webhook');
  }

  supports(adapter: string): boolean {
    return adapter === 'custom' || adapter === 'webhook';
  }

  async dispatch(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    const progress: AgentProgressUpdate[] = [];
    this.recordProgress(request, progress, 'prepare', 'Preparing signed webhook payload');
    this.recordProgress(request, progress, 'deliver', 'Issued webhook request to downstream target');
    this.recordProgress(request, progress, 'await_response', 'Waiting for webhook acknowledgement');
    return this.buildResponse(request, progress, { endpoint: request.target });
  }
}

export const createAgentCommandBus = (): AgentCommandBus => {
  const connectors: AgentCommandConnector[] = [
    new McpConnector(),
    new LangChainConnector(),
    new AutoGenConnector(),
    new WebhookConnector(),
  ];
  return new AgentCommandBus(connectors);
};
