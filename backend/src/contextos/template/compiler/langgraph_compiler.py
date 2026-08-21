from collections import defaultdict
from typing import Any, Callable

from langgraph.graph import END, START, StateGraph

from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import EdgeSpec, NodeSpec, TemplateManifest


class LangGraphManifestCompiler:
    def compile(self, manifest: TemplateManifest) -> "CompiledManifestGraph":
        graph = StateGraph(dict)
        node_by_id = {node.id: node for node in manifest.graph.nodes}

        for node in manifest.graph.nodes:
            graph.add_node(node.id, _node_handler(node))

        conditional_edges: dict[str, list[EdgeSpec]] = defaultdict(list)
        for edge in manifest.graph.edges:
            if edge.condition is not None:
                conditional_edges[edge.source].append(edge)
            else:
                graph.add_edge(_endpoint(edge.source), _endpoint(edge.target))

        for source, edges in conditional_edges.items():
            source_node = node_by_id[source]
            path_map = {edge.condition: _endpoint(edge.target) for edge in edges if edge.condition is not None}
            graph.add_conditional_edges(source, _router_for(source_node), path_map)

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


def _node_handler(node: NodeSpec) -> Callable[[dict[str, object]], dict[str, object]]:
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
    output_key = node.config.get("output_key")
    if output_key is not None:
        update[str(output_key)] = node.config.get("output")
    return update


def _router_for(node: NodeSpec) -> Callable[[dict[str, object]], str]:
    state_key = str(node.config.get("state_key", "route"))
    return lambda state: str(state.get(state_key, ""))


def _visited(state: dict[str, object], node_id: str) -> list[str]:
    return [*list(state.get("visited_nodes", [])), node_id]


def _endpoint(node_id: str) -> str:
    if node_id == "START":
        return START
    if node_id == "END":
        return END
    return node_id
