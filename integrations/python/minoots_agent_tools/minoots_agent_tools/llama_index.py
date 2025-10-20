from __future__ import annotations

from typing import Any, Dict, Optional, Union

try:
    from llama_index.core.tools import FunctionTool
except ImportError as exc:  # pragma: no cover - optional dependency guard
    raise ImportError(
        "llama-index-core is required for the MINOOTS LlamaIndex integration. Install with "
        "'pip install minoots-agent-tools[llamaindex]'"
    ) from exc

from .client import MinootsClient


def build_llamaindex_timer_tool(
    client: MinootsClient,
    *,
    name: str = "minoots_schedule_timer",
    description: Optional[str] = None,
) -> FunctionTool:
    """Create a LlamaIndex FunctionTool that schedules timers via MINOOTS."""

    async def _schedule_timer(  # type: ignore[override]
        timer_name: str,
        requested_by: Optional[str] = None,
        duration: Optional[Union[str, int]] = None,
        fire_at: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        labels: Optional[Dict[str, str]] = None,
        action_bundle: Optional[Dict[str, Any]] = None,
        agent_binding: Optional[Dict[str, Any]] = None,
        region: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Schedule a MINOOTS timer from within a LlamaIndex agent."""

        if duration is None and fire_at is None:
            raise ValueError("Provide either duration or fire_at when scheduling a timer")

        return await client.schedule_timer_async(
            name=timer_name,
            requested_by=requested_by,
            duration=duration,
            fire_at=fire_at,
            metadata=metadata,
            labels=labels,
            action_bundle=action_bundle,
            agent_binding=agent_binding,
            region=region,
        )

    tool_description = description or (
        "Schedule a durable timer via the MINOOTS control plane. Provide a duration "
        "(for example '15m' or 300000) or an absolute fire_at timestamp."
    )

    return FunctionTool.from_defaults(
        fn=_schedule_timer,
        name=name,
        description=tool_description,
        return_direct=True,
    )
