from __future__ import annotations

import asyncio
import json
import re
from typing import Any, AsyncIterator, Dict, Iterable, Optional

import httpx

DEFAULT_BASE_URL = "https://api-m3waemr5lq-uc.a.run.app"
DEFAULT_TIMEOUT = 10.0

__all__ = [
    "AsyncMinootsClient",
    "MinootsError",
    "MinootsTimeoutError",
    "MinootsAPIError",
]


class MinootsError(Exception):
    """Base error for Python SDK."""


class MinootsTimeoutError(MinootsError):
    """Raised when a request times out."""


class MinootsAPIError(MinootsError):
    """Raised when the API returns a non-success status code."""

    def __init__(self, message: str, status: int, details: Any | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.details = details


class AsyncMinootsClient:
    """Async MINOOTS client built on httpx.AsyncClient."""

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        api_key: Optional[str] = None,
        agent_id: Optional[str] = "sdk_agent",
        team: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._base_url = base_url.rstrip('/')
        self._api_key = api_key
        self._agent_id = agent_id
        self._team = team
        self._timeout = timeout
        self._client = client or httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout)
        self._owns_client = client is None

    async def __aenter__(self) -> "AsyncMinootsClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def with_overrides(self, **overrides: Any) -> "AsyncMinootsClient":
        """Clone the client with updated defaults without mutating the original."""

        base_url = overrides.get("base_url", self._base_url)
        share_client = base_url.rstrip('/') == self._base_url

        if share_client:
            clone = AsyncMinootsClient(
                base_url=self._base_url,
                api_key=overrides.get("api_key", self._api_key),
                agent_id=overrides.get("agent_id", self._agent_id),
                team=overrides.get("team", self._team),
                timeout=overrides.get("timeout", self._timeout),
                client=self._client,
            )
            clone._owns_client = False
            clone._timeout = overrides.get("timeout", self._timeout)
            return clone

        return AsyncMinootsClient(
            base_url=base_url,
            api_key=overrides.get("api_key", self._api_key),
            agent_id=overrides.get("agent_id", self._agent_id),
            team=overrides.get("team", self._team),
            timeout=overrides.get("timeout", self._timeout),
        )

    def set_api_key(self, api_key: Optional[str]) -> None:
        self._api_key = api_key

    def set_agent(self, agent_id: Optional[str]) -> None:
        self._agent_id = agent_id

    def set_team(self, team: Optional[str]) -> None:
        self._team = team

    async def health(self) -> Dict[str, Any]:
        return await self._request("GET", "/health")

    async def create_timer(
        self,
        *,
        name: Optional[str] = None,
        duration: str | int,
        agent_id: Optional[str] = None,
        team: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        events: Optional[Dict[str, Any]] = None,
        **extra: Any,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"duration": duration, **extra}
        if name:
            payload["name"] = name

        resolved_agent = agent_id or self._agent_id
        resolved_team = team or self._team
        if resolved_agent:
            payload.setdefault("agent_id", resolved_agent)
        if resolved_team:
            payload.setdefault("team", resolved_team)
        if metadata:
            payload["metadata"] = metadata
        if events:
            payload["events"] = events

        return await self._request("POST", "/timers", json=payload)

    async def create_timer_with_webhook(
        self,
        *,
        name: str,
        duration: str | int,
        webhook: str,
        message: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        **extra: Any,
    ) -> Dict[str, Any]:
        event_payload = {
            "on_expire": {
                "message": message or f"Timer {name} expired",
                "webhook": webhook,
                "data": data or {},
            }
        }
        return await self.create_timer(
            name=name,
            duration=duration,
            events=event_payload,
            **extra,
        )

    async def create_recurring_check(self, name: str, interval: str | int, webhook: str) -> Dict[str, Any]:
        return await self.create_timer_with_webhook(
            name=name,
            duration=interval,
            webhook=webhook,
            message=f"Recurring check: {name}",
            data={"type": "recurring_check", "interval": interval},
        )

    async def get_timer(self, timer_id: str) -> Dict[str, Any]:
        return await self._request("GET", f"/timers/{timer_id}")

    async def list_timers(
        self,
        *,
        agent_id: Optional[str] = None,
        team: Optional[str] = None,
        status: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if agent_id:
            params["agent_id"] = agent_id
        if team:
            params["team"] = team
        if status:
            params["status"] = status
        if limit:
            params["limit"] = limit
        if cursor:
            params["cursor"] = cursor
        return await self._request("GET", "/timers", params=params)

    async def delete_timer(self, timer_id: str) -> Dict[str, Any]:
        return await self._request("DELETE", f"/timers/{timer_id}")

    async def quick_wait(self, duration: str | int, **options: Any) -> Dict[str, Any]:
        payload = {"duration": duration, **options}
        if "name" not in payload:
            loop = asyncio.get_running_loop()
            payload["name"] = f"quick_wait_{int(loop.time() * 1000)}"
        return await self._request("POST", "/quick/wait", json=self._merge_timer_defaults(payload))

    async def wait_for(
        self,
        duration: str | int,
        *,
        poll_interval_seconds: float = 1.0,
        agent_id: Optional[str] = None,
        **options: Any,
    ) -> Dict[str, Any]:
        response = await self.quick_wait(duration, agent_id=agent_id, **options)
        timer_id = response.get("timer", {}).get("id")
        if not timer_id:
            raise MinootsError("Timer ID missing from quick_wait response")
        return await self.poll_timer(timer_id, interval_seconds=poll_interval_seconds)

    async def poll_timer(
        self,
        timer_id: str,
        *,
        interval_seconds: float = 1.0,
        stop_statuses: Iterable[str] = ("expired", "completed", "settled", "cancelled"),
    ) -> Dict[str, Any]:
        stop_set = {status.lower() for status in stop_statuses}
        while True:
            result = await self.get_timer(timer_id)
            timer = result.get("timer", {})
            status = str(timer.get("status", "")).lower()
            remaining = timer.get("timeRemaining")

            if status in stop_set or (isinstance(remaining, (int, float)) and remaining <= 0):
                return timer

            await asyncio.sleep(interval_seconds)

    async def stream_timer_events(
        self,
        tenant_id: str,
        *,
        topics: Optional[Iterable[str]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        params: Dict[str, Any] = {"tenantId": tenant_id}
        if topics:
            params["topic"] = list(topics)

        headers = self._headers()
        headers["accept"] = "text/event-stream"

        async with self._client.stream("GET", "/timers/stream", params=params, headers=headers, timeout=None) as response:
            if response.status_code >= 400:
                body = await response.aread()
                details = body.decode("utf-8", errors="ignore")
                raise MinootsAPIError("Failed to open timer event stream", response.status_code, details)

            async for line in response.aiter_lines():
                if not line:
                    continue
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if not data:
                        continue
                    try:
                        yield json.loads(data)
                    except json.JSONDecodeError:
                        continue

    @staticmethod
    def parse_duration(duration: str | int) -> int:
        if isinstance(duration, (int, float)):
            if duration < 0:
                raise MinootsError("Duration must be positive")
            return int(duration)

        match = re.match(r"^(\d+)(ms|s|m|h|d)$", str(duration).strip(), re.IGNORECASE)
        if not match:
            raise MinootsError(f"Invalid duration format: {duration}")

        value = int(match.group(1))
        unit = match.group(2).lower()
        multipliers = {
            "ms": 1,
            "s": 1000,
            "m": 60_000,
            "h": 3_600_000,
            "d": 86_400_000,
        }
        try:
            return value * multipliers[unit]
        except KeyError as exc:
            raise MinootsError(f"Unsupported duration unit: {unit}") from exc

    @staticmethod
    def format_time_remaining(milliseconds: int) -> str:
        seconds_total = max(0, int(milliseconds // 1000))
        seconds = seconds_total % 60
        minutes_total = seconds_total // 60
        minutes = minutes_total % 60
        hours = minutes_total // 60
        if hours:
            return f"{hours}h {minutes}m {seconds}s"
        if minutes:
            return f"{minutes}m {seconds}s"
        return f"{seconds}s"

    def _merge_timer_defaults(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        merged = dict(payload)
        if self._agent_id and "agent_id" not in merged:
            merged["agent_id"] = self._agent_id
        if self._team and "team" not in merged:
            merged["team"] = self._team
        return merged

    def _headers(self) -> Dict[str, str]:
        headers = {
            "content-type": "application/json",
            "user-agent": "minoots-python-sdk/0.1.0",
        }
        if self._api_key:
            headers["x-api-key"] = self._api_key
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            response = await self._client.request(
                method,
                path,
                json=json,
                params=params,
                headers=self._headers(),
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise MinootsTimeoutError(f"Request to {path} timed out after {self._timeout}s") from exc
        except httpx.HTTPError as exc:
            raise MinootsError(str(exc)) from exc

        try:
            data = response.json()
        except json.JSONDecodeError:
            data = {}

        if response.status_code >= 400:
            message = data.get("error") if isinstance(data, dict) else response.text
            raise MinootsAPIError(message or f"API error {response.status_code}", response.status_code, data)

        return data if isinstance(data, dict) else {"data": data}
