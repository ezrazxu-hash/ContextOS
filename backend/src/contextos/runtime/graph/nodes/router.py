from __future__ import annotations

from typing import Any

from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec


class RouterNodeExecutionError(RuntimeError):
    def __init__(self, code: str, node_id: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.node_id = node_id


class RouterNodeExecutor:
    node_type = "router"

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        def execute(state: dict[str, object]) -> dict[str, object]:
            source = str(node.config.get("source", ""))
            found, source_value = _resolve_state_path(source, state)
            if not found:
                raise RouterNodeExecutionError("router.source_missing", node.id, f"Router source not found: {source}")

            route = _route_for(node, source_value)
            state_key = str(node.config.get("state_key", "route"))
            next_state = {**state, state_key: route}
            _append_event(next_state, node, runtime_context, route)
            return next_state

        return execute


def _route_for(node: NodeSpec, source_value: object) -> str:
    routes = node.config.get("routes", {})
    if not isinstance(routes, dict):
        routes = {}

    source_key = str(source_value)
    if source_key in routes:
        return str(routes[source_key])

    default_route = node.config.get("default_route")
    if default_route is not None:
        return str(default_route)

    raise RouterNodeExecutionError("router.route_unknown", node.id, f"Router has no route for value: {source_key}")


def _resolve_state_path(expression: str, state: dict[str, object]) -> tuple[bool, object]:
    if not expression.startswith("$state."):
        return True, expression

    value: Any = state
    for part in expression.removeprefix("$state.").split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif hasattr(value, part):
            value = getattr(value, part)
        else:
            return False, None
    return True, value


def _append_event(
    state: dict[str, object],
    node: NodeSpec,
    runtime_context: RuntimeContext,
    route: str,
) -> None:
    events = list(state.get("runtime_events", []))
    events.append(
        {
            "type": "router_route",
            "data": {
                "node_id": node.id,
                "trace_id": runtime_context.trace_id,
                "route": route,
            },
        }
    )
    state["runtime_events"] = events
