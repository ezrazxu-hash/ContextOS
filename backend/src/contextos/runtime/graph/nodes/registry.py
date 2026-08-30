from __future__ import annotations

from contextos.runtime.graph.nodes.protocol import NodeExecutor


class DuplicateNodeExecutorError(ValueError):
    pass


class UnknownNodeExecutorError(LookupError):
    pass


class NodeExecutorRegistry:
    def __init__(self) -> None:
        self._executors: dict[str, NodeExecutor] = {}

    def register(self, executor: NodeExecutor) -> None:
        node_type = executor.node_type
        if node_type in self._executors:
            raise DuplicateNodeExecutorError(f"Node executor already registered: {node_type}")
        self._executors[node_type] = executor

    def get(self, node_type: str) -> NodeExecutor:
        executor = self._executors.get(node_type)
        if executor is None:
            raise UnknownNodeExecutorError(f"Node executor is not registered: {node_type}")
        return executor

    def has(self, node_type: str) -> bool:
        return node_type in self._executors

    def node_types(self) -> list[str]:
        return sorted(self._executors)
