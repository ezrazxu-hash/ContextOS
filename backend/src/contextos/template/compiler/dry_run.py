from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
from contextos.runtime.graph.nodes.references import output_state_key, resolve_reference, route_state_key, write_node_output
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
            if node.type in {"prompt", "llm", "tool"} or node.config.get("output_key") is not None:
                value = _dry_value(node, update)
                update[output_state_key(node)] = value
                write_node_output(update, node, value)
            if node.type == "output":
                update["output"] = _dry_value(node, update)
            if node.type == "condition":
                update[route_state_key(node)] = "true"
            return update

        return run


def _dry_value(node: NodeSpec, state: dict[str, object]) -> object:
    if node.type == "tool":
        return {"dry_run": node.id}
    if node.type == "output":
        source = node.config.get("source", f"dry_run:{node.id}")
        found, value = resolve_reference(source, state)
        return value if found else source
    return str(node.config.get("output", f"dry_run:{node.id}"))


def _dry_run_registry() -> NodeExecutorRegistry:
    registry = NodeExecutorRegistry()
    for node_type in ["prompt", "llm", "tool", "condition", "output"]:
        registry.register(_DryRunExecutor(node_type))
    return registry
