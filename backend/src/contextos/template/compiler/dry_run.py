from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.compiler.compile_service import GraphCompileError, GraphCompileService
from contextos.template.manifest.schema import NodeSpec, TemplateManifest


@dataclass(frozen=True)
class CompileDryRunResult:
    success: bool
    graph_state: dict[str, object]


class CompileDryRunError(Exception):
    def __init__(self, code: str, field_path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field_path = field_path


class CompileDryRunService:
    def __init__(self, compile_service: GraphCompileService | None = None) -> None:
        self._compile_service = compile_service or GraphCompileService()

    def run(
        self,
        manifest: TemplateManifest,
        *,
        graph_state: dict[str, object] | None = None,
        provider_call: Callable[[], object] | None = None,
        tool_call: Callable[[], object] | None = None,
    ) -> CompileDryRunResult:
        del provider_call, tool_call
        try:
            graph = self._compile_service.compile(manifest, node_executor_registry=_dry_run_registry())
        except GraphCompileError as exc:
            raise CompileDryRunError(exc.code, exc.field_path, str(exc)) from exc
        state = graph.run(
            graph_state or {},
            RuntimeContext("dry-run-session", "dry-run-timeline", "dry-run-trace"),
        )
        return CompileDryRunResult(success=True, graph_state=state)


class _DryRunExecutor:
    def __init__(self, node_type: str) -> None:
        self.node_type = node_type

    def build(self, node: NodeSpec, runtime_context: RuntimeContext):
        del runtime_context

        def run(state: dict[str, object]) -> dict[str, object]:
            update = {**state, "visited_nodes": [*state.get("visited_nodes", []), node.id]}
            output_key = node.config.get("output_key")
            if output_key is not None:
                value = update.get(str(output_key), _dry_value(node)) if node.type == "output" else _dry_value(node)
                update[str(output_key)] = value
                if node.type == "output":
                    update["output"] = value
            state_key = node.config.get("state_key")
            if state_key is not None and str(state_key) not in update:
                update[str(state_key)] = str(node.config.get("default_route", "true"))
            return update

        return run


def _dry_value(node: NodeSpec) -> object:
    if node.type == "tool":
        return {"dry_run": node.id}
    return str(node.config.get("output", f"dry_run:{node.id}"))


def _dry_run_registry() -> NodeExecutorRegistry:
    registry = NodeExecutorRegistry()
    for node_type in ["llm", "agent", "tool", "condition", "router", "output"]:
        registry.register(_DryRunExecutor(node_type))
    return registry
