from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar


T = TypeVar("T")


class CompiledGraphCache:
    def __init__(self) -> None:
        self._graphs: dict[str, object] = {}

    def get_or_compile(self, agent_version_id: str, compile_fn: Callable[[], T]) -> T:
        if agent_version_id not in self._graphs:
            self._graphs[agent_version_id] = compile_fn()
        return self._graphs[agent_version_id]  # type: ignore[return-value]

    def clear(self) -> None:
        self._graphs.clear()
