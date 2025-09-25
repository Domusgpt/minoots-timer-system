# Action Orchestrator

The action orchestrator consumes timer events from the horology kernel and executes the associated actions. It translates
fired timers into webhooks, agent prompts, and workflow triggers.

## Current capabilities
- Subscribes to NATS JetStream (or STDIN fallback) for timer events.
- Executes webhook actions with contextual metadata.
- Emits stubbed agent prompts for MCP/LangChain/autogen adapters (ready for integration).

## Running locally
```bash
cd services/action-orchestrator
npm install
npm run dev
```

Set `NATS_URL` to point to a running NATS server. Without it, the service reads JSON events from STDIN, which is useful for quick
testing:
```bash
node services/action-orchestrator/src/index.ts < demo-events.jsonl
```

## Roadmap
- Add persistent retry queues and DLQs for failed actions.
- Integrate with MCP, LangChain, and AutoGen to deliver agent commands.
- Record execution telemetry back into the control plane for observability.
