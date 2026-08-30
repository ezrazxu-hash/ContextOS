from __future__ import annotations

from typing import Any

from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec


class ConditionNodeExecutionError(RuntimeError):
    def __init__(self, code: str, node_id: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.node_id = node_id


class ConditionNodeExecutor:
    node_type = "condition"

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        def execute(state: dict[str, object]) -> dict[str, object]:
            source = str(node.config.get("source", ""))
            found, source_value = _resolve_state_path(source, state)
            if not found:
                raise ConditionNodeExecutionError("condition.source_missing", node.id, f"Condition source not found: {source}")

            route = "true" if _evaluate(node, source_value) else "false"
            state_key = str(node.config.get("state_key", "route"))
            next_state = {**state, state_key: route}
            _append_event(next_state, node, runtime_context, route)
            return next_state

        return execute


def _evaluate(node: NodeSpec, source_value: object) -> bool:
    operator = str(node.config.get("operator", "exists"))
    expected = node.config.get("value")
    try:
        if operator == "eq":
            return source_value == expected
        if operator == "ne":
            return source_value != expected
        if operator == "gt":
            return bool(source_value > expected)  # type: ignore[operator]
        if operator == "gte":
            return bool(source_value >= expected)  # type: ignore[operator]
        if operator == "lt":
            return bool(source_value < expected)  # type: ignore[operator]
        if operator == "lte":
            return bool(source_value <= expected)  # type: ignore[operator]
        if operator == "exists":
            return source_value is not None
        if operator == "contains":
            return bool(expected in source_value)  # type: ignore[operator]
        if operator == "is_true":
            return source_value is True
        if operator == "is_false":
            return source_value is False
    except TypeError as error:
        raise ConditionNodeExecutionError("condition.type_incompatible", node.id, f"Incompatible values for condition operator: {operator}") from error

    raise ConditionNodeExecutionError("condition.operator_unknown", node.id, f"Unknown condition operator: {operator}")


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
            "type": "condition_route",
            "data": {
                "node_id": node.id,
                "trace_id": runtime_context.trace_id,
                "route": route,
            },
        }
    )
    state["runtime_events"] = events
