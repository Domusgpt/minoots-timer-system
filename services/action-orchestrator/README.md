# Action Orchestrator

The action orchestrator consumes timer events from the horology kernel and executes the associated actions. It translates
fired timers into webhooks, agent prompts, and workflow triggers.

## Current capabilities
- Streams timer events directly from the horology kernel gRPC interface (or falls back to NATS/STDIN).
- Executes webhook actions with contextual metadata.
- Emits stubbed agent prompts for MCP/LangChain/autogen adapters (ready for integration).

## Running locally
```bash
cd services/action-orchestrator
npm install
KERNEL_GRPC_URL=localhost:50051 npm run dev
```

If `KERNEL_GRPC_URL` is not provided the orchestrator looks for `NATS_URL`/`NATS_SUBJECT`, and finally falls back to STDIN JSON
events for manual testing.

## Roadmap
- Add persistent retry queues and DLQs for failed actions.
- Integrate with MCP, LangChain, and AutoGen to deliver agent commands.
- Record execution telemetry back into the control plane for observability.
