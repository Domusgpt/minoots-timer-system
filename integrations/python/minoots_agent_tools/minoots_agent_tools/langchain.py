from __future__ import annotations

from typing import Any, Dict, Optional, Union

from pydantic import BaseModel, Field, root_validator

try:
    from langchain_core.tools import BaseTool
except ImportError as exc:  # pragma: no cover - optional dependency guard
    raise ImportError(
        "langchain-core is required to use AtoTimerTool. Install with 'pip install "
        "minoots-agent-tools[langchain]'"
    ) from exc

from .client import MinootsClient, REGION_LABEL_KEY


class _TimerInput(BaseModel):
    name: str = Field(..., description="Human friendly timer name")
    requested_by: Optional[str] = Field(
        None,
        description="Identifier recorded in the timer audit trail",
    )
    duration: Optional[Union[str, int]] = Field(
        None,
        description="ISO 8601 duration (e.g. '15m') or milliseconds",
    )
    fire_at: Optional[str] = Field(
        None,
        description="Absolute ISO timestamp when the timer should fire",
    )
    metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Arbitrary JSON metadata persisted with the timer",
    )
    labels: Optional[Dict[str, str]] = Field(
        default=None,
        description="Key/value labels used for routing and search",
    )
    action_bundle: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Structured action bundle to execute when the timer fires",
    )
    agent_binding: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Agent binding payload for the execution mesh",
    )
    region: Optional[str] = Field(
        default=None,
        description="Preferred kernel region (defaults to the client's region)",
    )

    @root_validator
    def _validate_schedule_window(cls, values: Dict[str, Any]) -> Dict[str, Any]:  # noqa: D401
        """Ensure either duration or fire_at is provided."""

        if not values.get("duration") and not values.get("fire_at"):
            raise ValueError("Either duration or fire_at must be supplied")
        return values

    class Config:
        allow_population_by_field_name = True


class AtoTimerTool(BaseTool):
    """LangChain tool for scheduling timers in the MINOOTS control plane."""

    name = "minoots_schedule_timer"
    description = (
        "Schedule a durable timer via the MINOOTS control plane. "
        "Provide a duration (e.g. '15m') or an absolute fire_at timestamp."
    )
    args_schema = _TimerInput

    def __init__(
        self,
        client: MinootsClient,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> None:
        super().__init__()
        self._client = client
        if name:
            self.name = name
        if description:
            self.description = description

    def _run(self, **kwargs: Any) -> str:
        data = self.args_schema(**kwargs)
        timer = self._client.schedule_timer(
            name=data.name,
            requested_by=data.requested_by,
            duration=data.duration,
            fire_at=data.fire_at,
            metadata=data.metadata,
            labels=data.labels,
            action_bundle=data.action_bundle,
            agent_binding=data.agent_binding,
            region=data.region,
        )
        return self._summarize(timer)

    async def _arun(self, **kwargs: Any) -> str:
        data = self.args_schema(**kwargs)
        timer = await self._client.schedule_timer_async(
            name=data.name,
            requested_by=data.requested_by,
            duration=data.duration,
            fire_at=data.fire_at,
            metadata=data.metadata,
            labels=data.labels,
            action_bundle=data.action_bundle,
            agent_binding=data.agent_binding,
            region=data.region,
        )
        return self._summarize(timer)

    @staticmethod
    def _summarize(timer: Dict[str, Any]) -> str:
        timer_id = timer.get("id") or timer.get("timerId", "unknown")
        fire_at = timer.get("fireAt") or timer.get("fire_at_iso") or timer.get("fire_at")
        labels = timer.get("labels")
        region = None
        if isinstance(labels, dict):
            region = labels.get(REGION_LABEL_KEY)
        summary_parts = [f"timer {timer_id}"]
        if fire_at:
            summary_parts.append(f"fires at {fire_at}")
        if region:
            summary_parts.append(f"region={region}")
        return " ".join(summary_parts)
