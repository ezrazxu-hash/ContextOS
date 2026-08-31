from __future__ import annotations

import re
from typing import Any

from contextos.template.manifest.schema import NodeSpec


_KEY_PART_RE = re.compile(r"[^A-Za-z0-9_]+")
_DEFAULT_OUTPUT_PORTS = {
    "agent": "response",
    "llm": "response",
    "prompt": "out",
    "tool": "result",
}


def output_state_key(node: NodeSpec, port: str | None = None) -> str:
    explicit = node.config.get("output_key")
    if explicit:
        return str(explicit)
    return internal_state_key(node.id, port or _DEFAULT_OUTPUT_PORTS.get(node.type, "output"))


def write_node_output(state: dict[str, object], node: NodeSpec, value: object) -> None:
    outputs = dict(state.get("node_outputs", {})) if isinstance(state.get("node_outputs"), dict) else {}
    outputs[node.id] = value
    state["node_outputs"] = outputs


def route_state_key(node: NodeSpec) -> str:
    explicit = node.config.get("state_key")
    if explicit:
        return str(explicit)
    return internal_state_key(node.id, "route")


def internal_state_key(node_id: str, port: str) -> str:
    return f"__{_key_part(node_id)}_{_key_part(port)}"


def resolve_reference_value(reference: object, state: dict[str, object]) -> object:
    found, value = resolve_reference(reference, state)
    return value if found else None


def resolve_reference(reference: object, state: dict[str, object]) -> tuple[bool, object]:
    if isinstance(reference, dict):
        reference_type = reference.get("type")
        if reference_type == "node_output":
            node_id = reference.get("node_id")
            port = reference.get("port")
            if node_id is None or port is None:
                return False, None
            node_outputs = state.get("node_outputs")
            if isinstance(node_outputs, dict) and str(node_id) in node_outputs:
                return _resolve_port(node_outputs[str(node_id)], str(port))
            return _resolve_state_key(internal_state_key(str(node_id), str(port)), state)
        if reference_type == "literal":
            return True, reference.get("value")
        if reference_type == "workflow_input":
            name = reference.get("name")
            if name is None:
                return False, None
            return _resolve_state_key(str(name), state)
        if reference_type == "expression":
            return _resolve_expression(str(reference.get("value", "")), state)
        return True, reference

    if isinstance(reference, str):
        return _resolve_expression(reference, state)

    return True, reference


def _resolve_port(value: object, port: str) -> tuple[bool, object]:
    if isinstance(value, dict):
        if port in value:
            return True, value[port]
        if port in _DEFAULT_OUTPUT_PORTS.values() or port == "output":
            return True, value
        return False, None
    return True, value


def _resolve_expression(expression: str, state: dict[str, object]) -> tuple[bool, object]:
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


def _resolve_state_key(key: str, state: dict[str, object]) -> tuple[bool, object]:
    if key not in state:
        return False, None
    return True, state[key]


def _key_part(value: str) -> str:
    normalized = _KEY_PART_RE.sub("_", value).strip("_")
    if not normalized:
        return "value"
    if normalized[0].isdigit():
        return f"_{normalized}"
    return normalized
