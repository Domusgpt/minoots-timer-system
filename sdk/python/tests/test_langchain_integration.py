"""Tests for the LangChain integration helpers."""

from __future__ import annotations

import importlib
import sys
import types
from typing import Any, Dict

import pytest


class _StubAsyncClient:
    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.quick_wait_calls: list[tuple[str, Dict[str, Any]]] = []
        self.poll_calls: list[tuple[str, float]] = []
        self.closed = False

    async def quick_wait(self, duration: str, **payload: Any) -> Dict[str, Any]:
        self.quick_wait_calls.append((duration, payload))
        return {"timer": {"id": "timer-123"}}

    async def poll_timer(self, timer_id: str, *, interval_seconds: float = 1.0) -> Dict[str, Any]:
        self.poll_calls.append((timer_id, interval_seconds))
        return {"status": "completed", "metadata": {"note": "ok"}, "duration": 1500}

    async def close(self) -> None:
        self.closed = True


@pytest.fixture()
def langchain_module(monkeypatch: pytest.MonkeyPatch):
    sys.modules.pop('minoots.integrations.langchain', None)

    langchain_pkg = types.ModuleType('langchain')
    tools_mod = types.ModuleType('langchain.tools')

    class _BaseTool:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._init_args = args
            self._init_kwargs = kwargs

    tools_mod.BaseTool = _BaseTool  # type: ignore[attr-defined]
    langchain_pkg.tools = tools_mod  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, 'langchain', langchain_pkg)
    monkeypatch.setitem(sys.modules, 'langchain.tools', tools_mod)

    module = importlib.import_module('minoots.integrations.langchain')
    return module


@pytest.mark.asyncio
async def test_langchain_tool_schedules_and_summarises(monkeypatch: pytest.MonkeyPatch, langchain_module):
    client = _StubAsyncClient()
    tool = langchain_module.AtoTimerTool(client=client)

    summary = await tool._arun('15s')

    assert 'timer-123' in summary
    assert client.quick_wait_calls == [('15s', {})]
    assert client.poll_calls == [('timer-123', 1.0)]


@pytest.mark.asyncio
async def test_langchain_tool_manages_owned_client(monkeypatch: pytest.MonkeyPatch, langchain_module):
    created_clients: list[_StubAsyncClient] = []

    class _FactoryClient(_StubAsyncClient):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(**kwargs)
            created_clients.append(self)

    monkeypatch.setattr(langchain_module, 'AsyncMinootsClient', _FactoryClient)

    tool = langchain_module.AtoTimerTool(base_url='https://api.example.com', api_key='key')
    await tool._ensure_client()
    await tool.aclose()

    assert created_clients and created_clients[0].closed is True
    assert tool._client is None


def test_langchain_tool_input_normalisation(langchain_module):
    tool = langchain_module.AtoTimerTool(client=_StubAsyncClient())

    assert tool._normalise_input('{"duration": "10s"}')['duration'] == '10s'
    assert tool._normalise_input(42)['duration'] == '42'
    assert tool._normalise_input({'duration': '5m', 'metadata': {'a': 1}})['metadata'] == {'a': 1}
