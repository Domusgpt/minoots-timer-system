"""Tests for the LlamaIndex integration helpers."""

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
        return {"timer": {"id": "timer-xyz"}}

    async def poll_timer(self, timer_id: str, *, interval_seconds: float = 1.0) -> Dict[str, Any]:
        self.poll_calls.append((timer_id, interval_seconds))
        return {"status": "completed", "metadata": {"note": "done"}, "duration": 900}

    async def close(self) -> None:
        self.closed = True


@pytest.fixture()
def llamaindex_module(monkeypatch: pytest.MonkeyPatch):
    sys.modules.pop('minoots.integrations.llamaindex', None)

    llamaindex_pkg = types.ModuleType('llama_index')
    core_pkg = types.ModuleType('llama_index.core')
    tools_mod = types.ModuleType('llama_index.core.tools')

    class _FunctionTool:
        def __init__(self, *, name: str, description: str, coroutine):
            self.name = name
            self.description = description
            self.coroutine = coroutine

        @classmethod
        def from_defaults(cls, **kwargs: Any):
            return cls(**kwargs)

    tools_mod.FunctionTool = _FunctionTool  # type: ignore[attr-defined]
    core_pkg.tools = tools_mod  # type: ignore[attr-defined]
    llamaindex_pkg.core = core_pkg  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, 'llama_index', llamaindex_pkg)
    monkeypatch.setitem(sys.modules, 'llama_index.core', core_pkg)
    monkeypatch.setitem(sys.modules, 'llama_index.core.tools', tools_mod)

    module = importlib.import_module('minoots.integrations.llamaindex')
    return module


@pytest.mark.asyncio
async def test_llamaindex_tool_uses_defaults(llamaindex_module):
    client = _StubAsyncClient()
    tool = llamaindex_module.create_minoots_tool(client=client, default_duration='20s')

    result = await tool.coroutine(metadata={'priority': 'high'})

    assert result['id'] == 'timer-xyz'
    assert client.quick_wait_calls[0][0] == '20s'
    assert client.quick_wait_calls[0][1]['metadata'] == {'priority': 'high'}
    assert client.poll_calls == [('timer-xyz', 1.0)]
    await tool.aclose()
    assert client.closed is False


@pytest.mark.asyncio
async def test_llamaindex_tool_closes_owned_client(monkeypatch: pytest.MonkeyPatch, llamaindex_module):
    created_clients: list[_StubAsyncClient] = []

    class _FactoryClient(_StubAsyncClient):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(**kwargs)
            created_clients.append(self)

    monkeypatch.setattr(llamaindex_module, 'AsyncMinootsClient', _FactoryClient)

    tool = llamaindex_module.create_minoots_tool(base_url='https://api.example.com', api_key='abc')
    owned_client = getattr(tool, '_minoots_client', None)

    assert owned_client is not None

    await tool.aclose()

    assert created_clients and created_clients[0].closed is True
