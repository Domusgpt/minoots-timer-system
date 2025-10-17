"""LlamaIndex integration helpers for MINOOTS."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from ..client import AsyncMinootsClient, MinootsError

try:
    from llama_index.core.tools import FunctionTool
except ImportError:  # pragma: no cover - optional dependency
    FunctionTool = None  # type: ignore

__all__ = ["create_minoots_tool"]


def create_minoots_tool(
    *,
    client: Optional[AsyncMinootsClient] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    agent_id: Optional[str] = None,
    team: Optional[str] = None,
    default_duration: str = "30s",
) -> "FunctionTool":
    """Create a LlamaIndex FunctionTool that schedules timers via MINOOTS."""

    if FunctionTool is None:  # pragma: no cover - executed only without llama-index
        raise RuntimeError("llama-index-core must be installed to use the MINOOTS tool")

    async_client = client or AsyncMinootsClient(
        **{k: v for k, v in {
            "base_url": base_url,
            "api_key": api_key,
            "agent_id": agent_id,
            "team": team,
        }.items() if v is not None}
    )

    async def _run(
        duration: Optional[str] = None,
        *,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        poll_interval_seconds: float = 1.0,
        **options: Any,
    ) -> Dict[str, Any]:
        resolved_duration = duration or default_duration
        if not resolved_duration:
            raise MinootsError("Duration is required when invoking the MINOOTS timer tool")

        timer_response = await async_client.quick_wait(resolved_duration, name=name, metadata=metadata, **options)
        timer = timer_response.get("timer") or {}
        timer_id = timer.get("id")
        if not timer_id:
            raise MinootsError("Timer creation response missing ID")

        final_timer = await async_client.poll_timer(timer_id, interval_seconds=max(0.1, float(poll_interval_seconds)))

        return {
            "id": timer_id,
            "status": final_timer.get("status"),
            "metadata": final_timer.get("metadata", {}),
            "team": final_timer.get("team"),
            "duration_ms": final_timer.get("duration"),
            "raw": json.loads(json.dumps(final_timer, default=str)),
        }

    tool = FunctionTool.from_defaults(
        name="minoots_timer",
        description=(
            "Schedule a timer using the MINOOTS independent timer network and wait until it settles. "
            "Pass duration like '45s' along with optional name, metadata, team, or webhook configuration."
        ),
        coroutine=_run,
    )

    setattr(tool, "_minoots_client", async_client)
    setattr(tool, "_minoots_owned", client is None)

    async def _aclose() -> None:
        if getattr(tool, "_minoots_owned", False):
            await async_client.close()

    setattr(tool, "aclose", _aclose)
    return tool
