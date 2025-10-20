# MINOOTS Agent Tools

Python connectors that let agent frameworks schedule durable timers via the MINOOTS
control plane. The package wraps the public REST API so LangChain workflows and
LlamaIndex agents can raise follow-up tasks without leaving their runtime.

## Installation

```bash
pip install minoots-agent-tools
# Optional extras
pip install "minoots-agent-tools[langchain]"      # LangChain StructuredTool support
pip install "minoots-agent-tools[llamaindex]"     # LlamaIndex FunctionTool wrapper
```

## Quick start

```python
from minoots_agent_tools.client import MinootsClient
from minoots_agent_tools.langchain import AtoTimerTool

client = MinootsClient(
    base_url="https://api.minoots.dev",
    api_key="sk-live-...",
    tenant_id="team-alpha",
    default_region="us-east",
)

tool = AtoTimerTool(client)
result = tool.run(
    name="daily-sync",
    duration="15m",
    requested_by="agent:planner",
    metadata={"context": "Prepare standup summary"},
)
print(result)
```

For LlamaIndex:

```python
from minoots_agent_tools.client import MinootsClient
from minoots_agent_tools.llama_index import build_llamaindex_timer_tool

client = MinootsClient(
    base_url="https://api.minoots.dev",
    api_key="sk-live-...",
    tenant_id="team-alpha",
)

tool = build_llamaindex_timer_tool(client)
await tool.acall(
    duration="45m",
    name="follow-up",
    requested_by="agent:memory",
    metadata={"reason": "Review session transcripts"},
)
```

## Configuration

All helpers share a small set of required inputs:

- `base_url` – MINOOTS control plane URL (usually `https://api.minoots.com`)
- `api_key` – Tenant-scoped API key with `timer.write` permissions
- `tenant_id` – Tenant identifier the key belongs to
- `default_region` – Optional regional hint used by the new multi-region gateway

The helpers accept additional keyword arguments:

- `requested_by` – Override the default requestor for audit trails
- `region` – Route a specific timer to a regional kernel replica
- `metadata`, `labels`, `action_bundle`, `agent_binding` – Pass-through to the API

## Development

The package uses `httpx` and `pydantic` only, so it works in both sync and async
agent environments. Run the lightweight smoke check before publishing:

```bash
python -m compileall minoots_agent_tools
```

