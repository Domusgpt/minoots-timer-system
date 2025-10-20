"""Agent tooling for interacting with the MINOOTS timer platform."""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

__all__ = ["MinootsClient", "AtoTimerTool", "build_llamaindex_timer_tool"]


def __getattr__(name: str) -> Any:  # pragma: no cover - thin import shim
    if name == "MinootsClient":
        return import_module(".client", __name__).MinootsClient
    if name == "AtoTimerTool":
        return import_module(".langchain", __name__).AtoTimerTool
    if name == "build_llamaindex_timer_tool":
        return import_module(".llama_index", __name__).build_llamaindex_timer_tool
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


if TYPE_CHECKING:  # pragma: no cover - import for type checkers only
    from .client import MinootsClient
    from .langchain import AtoTimerTool
    from .llama_index import build_llamaindex_timer_tool
