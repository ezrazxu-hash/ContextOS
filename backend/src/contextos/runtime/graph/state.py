from __future__ import annotations

from typing import Any, TypedDict


class AgentGraphState(TypedDict, total=False):
    session_id: str
    timeline_id: str
    run_id: str
    input: str
    messages: list[dict[str, object]]
    variables: dict[str, object]
    node_outputs: dict[str, object]
    tool_results: list[dict[str, object]]
    output: object
    visited_nodes: list[str]


class AgentGraphStateValidationError(ValueError):
    pass


def validate_agent_graph_state(state: dict[str, Any]) -> AgentGraphState:
    for field in ("session_id", "timeline_id", "run_id", "input"):
        if not state.get(field):
            raise AgentGraphStateValidationError(f"AgentGraphState missing required field: {field}")
    return AgentGraphState(state)
