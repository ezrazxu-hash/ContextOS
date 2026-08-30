from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


RuntimeEventType = Literal[
    "graph_started",
    "node_started",
    "token",
    "tool_call",
    "tool_result",
    "condition_route",
    "router_route",
    "node_finished",
    "checkpoint",
    "graph_finished",
    "graph_failed",
]


_RUNTIME_EVENT_TYPES = {
    "graph_started",
    "node_started",
    "token",
    "tool_call",
    "tool_result",
    "condition_route",
    "router_route",
    "node_finished",
    "checkpoint",
    "graph_finished",
    "graph_failed",
}

_LEGACY_TO_RUNTIME_TYPES = {
    "token": "token",
    "tool_call": "tool_call",
    "tool_result": "tool_result",
    "checkpoint": "checkpoint",
    "done": "graph_finished",
    "error": "graph_failed",
}

_RUNTIME_TO_LEGACY_TYPES = {
    "token": "token",
    "tool_call": "tool_call",
    "tool_result": "tool_result",
    "checkpoint": "checkpoint",
    "graph_finished": "done",
    "graph_failed": "error",
}


class RuntimeEventContractError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeEvent:
    type: RuntimeEventType
    data: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.type not in _RUNTIME_EVENT_TYPES:
            raise RuntimeEventContractError(f"unknown runtime event type: {self.type}")

    def to_dict(self) -> dict[str, object]:
        return {"type": self.type, "data": dict(self.data)}


def runtime_event_from_dict(payload: dict[str, object]) -> RuntimeEvent:
    event_type = _require_type(payload)
    if event_type not in _RUNTIME_EVENT_TYPES:
        raise RuntimeEventContractError(f"unknown runtime event type: {event_type}")
    return RuntimeEvent(type=event_type, data=_payload_data(payload))


def legacy_event_to_runtime_event(payload: dict[str, object]) -> RuntimeEvent:
    legacy_type = _require_type(payload)
    runtime_type = _LEGACY_TO_RUNTIME_TYPES.get(legacy_type)
    if runtime_type is None:
        raise RuntimeEventContractError(f"unknown runtime event type: {legacy_type}")
    return RuntimeEvent(type=runtime_type, data=_payload_data(payload))


def runtime_event_to_legacy_event(event: RuntimeEvent) -> dict[str, object]:
    legacy_type = _RUNTIME_TO_LEGACY_TYPES.get(event.type)
    if legacy_type is None:
        raise RuntimeEventContractError(f"runtime event cannot be represented as legacy SSE: {event.type}")
    return {"type": legacy_type, "data": dict(event.data)}


def _require_type(payload: dict[str, object]) -> str:
    event_type = payload.get("type")
    if not isinstance(event_type, str) or not event_type:
        raise RuntimeEventContractError("runtime event type is required")
    return event_type


def _payload_data(payload: dict[str, object]) -> dict[str, object]:
    data = payload.get("data", {})
    if not isinstance(data, dict):
        raise RuntimeEventContractError("runtime event data must be an object")
    return dict(data)
