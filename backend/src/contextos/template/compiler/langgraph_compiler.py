from collections import defaultdict
from typing import Any, Callable

from langgraph.graph import END, START, StateGraph

from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
from contextos.runtime.graph.nodes.references import output_state_key, route_state_key
from contextos.template.manifest.schema import EdgeSpec, NodeSpec, TemplateManifest
from contextos.template.validator.validator import ManifestValidationError


class LangGraphManifestCompiler:
    def compile(self, manifest: TemplateManifest, node_executor_registry: NodeExecutorRegistry | None = None) -> "CompiledManifestGraph":
        _validate_edges(manifest)
        graph = StateGraph(dict)
        node_by_id = {node.id: node for node in manifest.graph.nodes}

        for node in manifest.graph.nodes:
            graph.add_node(node.id, _node_handler(node, node_executor_registry))

        conditional_edges: dict[str, list[EdgeSpec]] = defaultdict(list)
        for edge in manifest.graph.edges:
            if edge.condition is not None:
                conditional_edges[edge.source].append(edge)
            else:
                graph.add_edge(_endpoint(edge.source), _endpoint(edge.target))

        for source, edges in conditional_edges.items():
            source_node = node_by_id[source]
            path_map = {edge.condition: _endpoint(edge.target) for edge in edges if edge.condition is not None}
            graph.add_conditional_edges(source, _router_for(source_node, path_map), path_map)

        return CompiledManifestGraph(graph.compile())


class CompiledManifestGraph:
    def __init__(self, compiled_graph: Any) -> None:
        self._compiled_graph = compiled_graph

    def run(self, graph_state: dict[str, object], runtime_context: RuntimeContext) -> dict[str, object]:
        state = dict(graph_state)
        state["_runtime_context"] = runtime_context
        completed = self._compiled_graph.invoke(state)
        completed.pop("_runtime_context", None)
        return completed


def _node_handler(
    node: NodeSpec,
    node_executor_registry: NodeExecutorRegistry | None = None,
) -> Callable[[dict[str, object]], dict[str, object]]:
    if node_executor_registry is not None:
        def run_with_executor(state: dict[str, object]) -> dict[str, object]:
            runtime_context = state.get("_runtime_context")
            if not isinstance(runtime_context, RuntimeContext):
                raise ValueError("_runtime_context is required")
            completed = node_executor_registry.get(node.type).build(node, runtime_context)(state)
            if list(completed.get("visited_nodes", [])) != list(state.get("visited_nodes", [])):
                return completed
            return {**completed, "visited_nodes": _visited(completed, node.id)}

        return run_with_executor

    if node.type == "human_approval":
        return lambda state: {
            **state,
            "visited_nodes": _visited(state, node.id),
            "interrupt": {
                "node_id": node.id,
                "type": "human_approval",
                "prompt": str(node.config.get("prompt", "")),
                "recoverable": True,
            },
        }

    return lambda state: _generic_node_update(state, node)


def _generic_node_update(state: dict[str, object], node: NodeSpec) -> dict[str, object]:
    update: dict[str, object] = {**state, "visited_nodes": _visited(state, node.id)}
    if node.type in {"prompt", "llm", "tool", "agent"} or node.config.get("output_key") is not None:
        update[output_state_key(node)] = node.config.get("output")
    return update


def _router_for(node: NodeSpec, path_map: dict[str, str]) -> Callable[[dict[str, object]], str]:
    state_key = route_state_key(node)

    def route(state: dict[str, object]) -> str:
        route_key = str(state.get(state_key, ""))
        if route_key not in path_map:
            raise ValueError(f"Unknown route '{route_key}' from node {node.id}")
        return route_key

    return route


def _visited(state: dict[str, object], node_id: str) -> list[str]:
    return [*list(state.get("visited_nodes", [])), node_id]


def _endpoint(node_id: str) -> str:
    if node_id == "START":
        return START
    if node_id == "END":
        return END
    return node_id


def _validate_edges(manifest: TemplateManifest) -> None:
    node_ids = {node.id for node in manifest.graph.nodes}
    allowed_boundary_nodes = {"START", "END"}
    seen_edges: set[tuple[str, str, str | None]] = set()
    seen_routes: set[tuple[str, str]] = set()
    for index, edge in enumerate(manifest.graph.edges):
        if edge.source not in node_ids and edge.source not in allowed_boundary_nodes:
            raise ManifestValidationError(
                "unknown_node",
                f"graph.edges[{index}].from",
                f"Edge references unknown source node: {edge.source}",
            )
        if edge.target not in node_ids and edge.target not in allowed_boundary_nodes:
            raise ManifestValidationError(
                "unknown_node",
                f"graph.edges[{index}].to",
                f"Edge references unknown target node: {edge.target}",
            )
        edge_key = (edge.source, edge.target, edge.condition)
        if edge_key in seen_edges:
            raise ManifestValidationError("duplicate_edge", f"graph.edges[{index}]", f"Duplicate edge: {edge.source}->{edge.target}")
        seen_edges.add(edge_key)
        if edge.condition is not None:
            route_key = (edge.source, edge.condition)
            if route_key in seen_routes:
                raise ManifestValidationError(
                    "duplicate_route",
                    f"graph.edges[{index}].condition",
                    f"Duplicate route '{edge.condition}' from node {edge.source}",
                )
            seen_routes.add(route_key)

    if not any(edge.source == "START" for edge in manifest.graph.edges):
        raise ManifestValidationError("missing_start_edge", "graph.edges", "Graph must have an outgoing START edge")
    if not any(edge.target == "END" for edge in manifest.graph.edges):
        raise ManifestValidationError("missing_end_edge", "graph.edges", "Graph must have an incoming END edge")
