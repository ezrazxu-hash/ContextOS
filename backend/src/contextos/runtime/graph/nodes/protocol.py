from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, runtime_checkable

from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec


NodeCallable = Callable[[dict[str, object]], dict[str, object]]


@runtime_checkable
class NodeExecutor(Protocol):
    node_type: str

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        ...
