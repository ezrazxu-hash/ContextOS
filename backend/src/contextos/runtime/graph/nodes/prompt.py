from __future__ import annotations

import re
from typing import Any

from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec


class PromptNodeExecutor:
    node_type = "prompt"

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        def execute(state: dict[str, object]) -> dict[str, object]:
            next_state = dict(state)
            _append_event(next_state, "node_started", node, runtime_context)
            values = _mapped_values(node.config.get("input_mapping", {}), state)
            rendered = _render_template(str(node.config.get("template", "")), values)
            next_state[str(node.config.get("output_key", "prompt"))] = rendered
            _append_event(next_state, "node_finished", node, runtime_context)
            return next_state

        return execute


def _mapped_values(mapping: object, state: dict[str, object]) -> dict[str, object]:
    if not isinstance(mapping, dict):
        return {}
    return {str(key): _resolve_state_path(str(value), state) for key, value in mapping.items()}


def _resolve_state_path(expression: str, state: dict[str, object]) -> object:
    if not expression.startswith("$state."):
        return expression

    value: Any = state
    for part in expression.removeprefix("$state.").split("."):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            value = getattr(value, part, None)
    return value


def _render_template(template: str, values: dict[str, object]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = values.get(key, "")
        return "" if value is None else str(value)

    return re.sub(r"\{\{\s*([^}]+?)\s*\}\}", replace, template)


def _append_event(
    state: dict[str, object],
    event_type: str,
    node: NodeSpec,
    runtime_context: RuntimeContext,
) -> None:
    events = list(state.get("runtime_events", []))
    events.append(
        {
            "type": event_type,
            "data": {
                "node_id": node.id,
                "trace_id": runtime_context.trace_id,
            },
        }
    )
    state["runtime_events"] = events
