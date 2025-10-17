"""LangChain integration helpers for the MINOOTS async client."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from ..client import AsyncMinootsClient, MinootsError

try:
    from langchain.tools import BaseTool  # type: ignore
    _LANGCHAIN_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    class BaseTool:  # type: ignore
        """Fallback base class used when LangChain isn't installed."""

        async def _arun(self, *_args: Any, **_kwargs: Any) -> str:
            raise RuntimeError("langchain must be installed to use AtoTimerTool")

    _LANGCHAIN_AVAILABLE = False


@dataclass
class _TimerResult:
    timer_id: str
    status: str
    metadata: Dict[str, Any]

    def summary(self) -> str:
        parts = [f"Timer {self.timer_id} settled with status {self.status}"]
        if self.metadata:
            parts.append(f"metadata={json.dumps(self.metadata, sort_keys=True)}")
        return " | ".join(parts)


class AtoTimerTool(BaseTool):
    """LangChain tool that schedules and awaits MINOOTS timers."""

    name = "minoots_schedule_timer"
    description = (
        "Schedule a MINOOTS timer and wait for completion. "
        "Input may be a natural-language duration (e.g. '30s') or JSON object with "
        "keys duration, name, metadata, team, agent_id, poll_interval_seconds."
    )

    def __init__(
        self,
        client: Optional[AsyncMinootsClient] = None,
        *,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        agent_id: Optional[str] = None,
        team: Optional[str] = None,
        default_duration: str = "30s",
    ) -> None:
        if not _LANGCHAIN_AVAILABLE:  # pragma: no cover - executed only without langchain
            raise RuntimeError("langchain must be installed to use AtoTimerTool")

        super().__init__()
        self._client = client
        self._owns_client = client is None
        self._client_kwargs = {
            "base_url": base_url,
            "api_key": api_key,
            "agent_id": agent_id,
            "team": team,
        }
        self._default_duration = default_duration

    async def _ensure_client(self) -> AsyncMinootsClient:
        if self._client is None:
            self._client = AsyncMinootsClient(**{k: v for k, v in self._client_kwargs.items() if v is not None})
        return self._client

    async def _arun(self, tool_input: Any, **kwargs: Any) -> str:  # type: ignore[override]
        payload = self._normalise_input(tool_input, **kwargs)
        duration = payload.pop("duration", self._default_duration)
        client = await self._ensure_client()

        try:
            poll_interval = payload.pop("poll_interval_seconds", None)
            poll_interval_seconds = float(poll_interval) if poll_interval is not None else 1.0
            timer_response = await client.quick_wait(duration, **payload)
            timer_data = timer_response.get("timer") or {}
            timer_id = timer_data.get("id")
            if not timer_id:
                raise MinootsError("Timer creation response missing ID")

            final_timer = await client.poll_timer(
                timer_id,
                interval_seconds=max(0.1, poll_interval_seconds),
            )
        except asyncio.CancelledError:  # pragma: no cover - cooperative cancellation
            raise
        except Exception as exc:  # pragma: no cover - errors converted to string for tool output
            raise MinootsError(str(exc)) from exc

        result = _TimerResult(
            timer_id=timer_id,
            status=str(final_timer.get("status", "unknown")),
            metadata={
                key: final_timer.get(key)
                for key in ("metadata", "team", "agentId", "name", "duration")
                if key in final_timer
            },
        )
        return result.summary()

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.close()
            self._client = None

    def _normalise_input(self, tool_input: Any, **kwargs: Any) -> Dict[str, Any]:
        if isinstance(tool_input, str):
            stripped = tool_input.strip()
            if not stripped:
                return {**kwargs}
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                return {"duration": stripped, **kwargs}
            else:
                if isinstance(data, dict):
                    return {**data, **kwargs}
                return {"duration": stripped, **kwargs}
        if isinstance(tool_input, dict):
            return {**tool_input, **kwargs}
        if tool_input is None:
            return {**kwargs}
        return {"duration": str(tool_input), **kwargs}

    # LangChain expects synchronous fallback for legacy chains. Encourage async usage.
    def _run(self, *args: Any, **kwargs: Any) -> str:  # type: ignore[override]
        raise NotImplementedError("Use the async interface `_arun` with LangChain async runners.")


__all__ = ["AtoTimerTool"]
