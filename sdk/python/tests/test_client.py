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


@pytest.mark.asyncio
@respx.mock
async def test_webhook_helpers_cover_crud_operations():
    respx.get("https://api.example.com/teams/team-42/webhooks/templates").mock(
        return_value=httpx.Response(200, json={"templates": [{"key": "slack-basic"}]})
    )
    respx.post("https://api.example.com/teams/team-42/webhooks").mock(
        return_value=httpx.Response(201, json={"success": True, "webhook": {"id": "wh-1", "url": "https://hook"}, "secret": "abc"})
    )
    respx.post("https://api.example.com/teams/team-42/webhooks/templates/slack-basic").mock(
        return_value=httpx.Response(201, json={"success": True, "webhook": {"id": "wh-t", "url": "https://hook"}, "secret": "templ"})
    )
    respx.get("https://api.example.com/teams/team-42/webhooks").mock(
        return_value=httpx.Response(200, json={"success": True, "webhooks": [{"id": "wh-1", "description": "Primary"}]})
    )
    respx.patch("https://api.example.com/teams/team-42/webhooks/wh-1").mock(
        return_value=httpx.Response(200, json={"success": True, "webhook": {"id": "wh-1", "description": "Updated"}})
    )
    respx.get("https://api.example.com/teams/team-42/webhooks/wh-1/logs").mock(
        return_value=httpx.Response(200, json={"success": True, "logs": {"entries": [{"id": "log-1"}], "nextCursor": None}})
    )
    respx.post("https://api.example.com/teams/team-42/webhooks/wh-1/test").mock(
        return_value=httpx.Response(200, json={"success": True, "eventId": "evt-test"})
    )
    respx.post("https://api.example.com/teams/team-42/events/custom-event/publish").mock(
        return_value=httpx.Response(202, json={"success": True, "eventId": "evt-custom"})
    )
    respx.delete("https://api.example.com/teams/team-42/webhooks/wh-1").mock(
        return_value=httpx.Response(200, json={"success": True, "deleted": True})
    )

    client = AsyncMinootsClient(base_url="https://api.example.com")

    templates = await client.list_webhook_templates("team-42")
    assert templates[0]["key"] == "slack-basic"

    templated = await client.create_webhook_from_template("team-42", "slack-basic", {"url": "https://hook"})
    assert templated["secret"] == "templ"

    created = await client.create_webhook("team-42", {"url": "https://hook"})
    assert created["webhook"]["id"] == "wh-1"

    webhooks = await client.list_webhooks("team-42")
    assert webhooks[0]["description"] == "Primary"

    updated = await client.update_webhook("team-42", "wh-1", {"description": "Updated"})
    assert updated["description"] == "Updated"

    logs = await client.get_webhook_logs("team-42", "wh-1", limit=10)
    assert logs["entries"][0]["id"] == "log-1"

    test_result = await client.trigger_webhook_test("team-42", "wh-1")
    assert test_result["eventId"] == "evt-test"

    publish_result = await client.publish_event("team-42", "custom-event", {"foo": "bar"})
    assert publish_result["eventId"] == "evt-custom"

    deletion = await client.delete_webhook("team-42", "wh-1")
    assert deletion["deleted"] is True

    await client.close()


@pytest.mark.asyncio
@respx.mock
async def test_integration_helpers_roundtrip():
    respx.put("https://api.example.com/teams/team-42/integrations/slack").mock(
        return_value=httpx.Response(200, json={"success": True, "integration": {"id": "team-42_slack", "type": "slack"}})
    )
    respx.get("https://api.example.com/teams/team-42/integrations").mock(
        return_value=httpx.Response(200, json={"success": True, "integrations": [{"id": "team-42_slack", "type": "slack"}]})
    )
    respx.post("https://api.example.com/teams/team-42/integrations/slack/test").mock(
        return_value=httpx.Response(200, json={"success": True, "response": {"ok": True}})
    )
    respx.post("https://api.example.com/teams/team-42/integrations/slack/notify").mock(
        return_value=httpx.Response(200, json={"success": True, "response": {"delivered": True}})
    )
    respx.delete("https://api.example.com/teams/team-42/integrations/slack").mock(
        return_value=httpx.Response(200, json={"success": True, "deleted": True})
    )

    client = AsyncMinootsClient(base_url="https://api.example.com")

    integration = await client.upsert_integration("team-42", "slack", {"webhookUrl": "https://hooks"})
    assert integration["type"] == "slack"

    integrations = await client.list_integrations("team-42")
    assert len(integrations) == 1

    test_result = await client.test_integration("team-42", "slack")
    assert test_result["success"] is True

    notify_result = await client.notify_integration("team-42", "slack", {"text": "Ping"})
    assert notify_result["response"]["delivered"] is True

    deletion = await client.delete_integration("team-42", "slack")
    assert deletion["deleted"] is True

    await client.close()
