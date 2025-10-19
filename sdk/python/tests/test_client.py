import asyncio
import json
from typing import Any, Dict

import httpx
import pytest
import respx

from minoots.client import (
    AsyncMinootsClient,
    MinootsAPIError,
    MinootsError,
    MinootsTimeoutError,
)


@pytest.mark.asyncio
@respx.mock
async def test_health_request_includes_headers_and_returns_payload():
    route = respx.get("https://api.example.com/health").mock(
        return_value=httpx.Response(200, json={"status": "ok"})
    )

    async with AsyncMinootsClient(base_url="https://api.example.com", api_key="test-key") as client:
        payload = await client.health()

    assert payload == {"status": "ok"}
    assert route.called

    request = route.calls[-1].request
    assert request.headers["x-api-key"] == "test-key"
    assert request.headers["content-type"] == "application/json"


@pytest.mark.asyncio
@respx.mock
async def test_create_timer_merges_defaults_and_extra_fields():
    route = respx.post("https://api.example.com/timers").mock(
        return_value=httpx.Response(200, json={"timer": {"id": "t-123", "status": "running"}})
    )

    client = AsyncMinootsClient(
        base_url="https://api.example.com",
        api_key="abc",
        agent_id="agent-7",
        team="team-24",
    )

    response = await client.create_timer(duration="15s", metadata={"source": "test"}, name="demo")
    await client.close()

    assert response["timer"]["id"] == "t-123"

    sent = json.loads(route.calls[-1].request.content.decode("utf-8"))
    assert sent["duration"] == "15s"
    assert sent["name"] == "demo"
    assert sent["metadata"] == {"source": "test"}
    assert sent["agent_id"] == "agent-7"
    assert sent["team"] == "team-24"


@pytest.mark.asyncio
@respx.mock
async def test_replay_timer_posts_overrides():
    route = respx.post("https://api.example.com/timers/base-timer/replay").mock(
        return_value=httpx.Response(201, json={"replay": {"id": "replayed"}})
    )

    client = AsyncMinootsClient(base_url="https://api.example.com", api_key="abc")

    response = await client.replay_timer(
        "base-timer",
        reason="manual",
        metadata={"source": "pytest"},
        dependencies=["dep-1"],
    )
    await client.close()

    assert response["replay"]["id"] == "replayed"
    payload = json.loads(route.calls[-1].request.content.decode("utf-8"))
    assert payload["reason"] == "manual"
    assert payload["metadata"] == {"source": "pytest"}
    assert payload["dependencies"] == ["dep-1"]


@pytest.mark.asyncio
@respx.mock
async def test_request_raises_api_error_with_details():
    respx.get("https://api.example.com/timers/t-404").mock(
        return_value=httpx.Response(404, json={"error": "Timer not found"})
    )

    client = AsyncMinootsClient(base_url="https://api.example.com")

    with pytest.raises(MinootsAPIError) as excinfo:
        await client.get_timer("t-404")

    await client.close()

    error = excinfo.value
    assert error.status == 404
    assert "not found" in str(error).lower()


@pytest.mark.asyncio
async def test_timeout_exception_converted_to_sdk_error():
    async def _raise_timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("boom")

    transport = httpx.MockTransport(_raise_timeout)
    owned_client = httpx.AsyncClient(base_url="https://api.example.com", transport=transport)

    client = AsyncMinootsClient(client=owned_client)

    with pytest.raises(MinootsTimeoutError):
        await client.health()

    await client.close()


@pytest.mark.asyncio
async def test_other_http_errors_raise_generic_sdk_error():
    async def _raise_error(request: httpx.Request) -> httpx.Response:
        raise httpx.NetworkError("network down")

    transport = httpx.MockTransport(_raise_error)
    owned_client = httpx.AsyncClient(base_url="https://api.example.com", transport=transport)

    client = AsyncMinootsClient(client=owned_client)

    with pytest.raises(MinootsError) as excinfo:
        await client.health()

    await client.close()
    assert "network" in str(excinfo.value).lower()
