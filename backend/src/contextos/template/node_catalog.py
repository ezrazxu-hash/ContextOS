from __future__ import annotations

from copy import deepcopy


_V1_NODE_CATALOG: list[dict[str, object]] = [
    {
        "type": "START",
        "display_name": "Start",
        "ports": {"inputs": [], "outputs": ["next"]},
        "required_fields": [],
        "connectable": {"incoming": False, "outgoing": True},
    },
    {
        "type": "END",
        "display_name": "End",
        "ports": {"inputs": ["in"], "outputs": []},
        "required_fields": [],
        "connectable": {"incoming": True, "outgoing": False},
    },
    {
        "type": "llm",
        "display_name": "LLM",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.prompt_template", "config.output_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "agent",
        "display_name": "Agent",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.instruction", "config.output_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "tool",
        "display_name": "Tool",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.tool_name", "config.output_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "condition",
        "display_name": "Condition",
        "ports": {"inputs": ["in"], "outputs": ["yes", "no"]},
        "required_fields": ["config.state_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "router",
        "display_name": "Router",
        "ports": {"inputs": ["in"], "outputs": ["routes"]},
        "required_fields": ["config.state_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "output",
        "display_name": "Output",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.source"],
        "connectable": {"incoming": True, "outgoing": True},
    },
]


def list_node_catalog() -> list[dict[str, object]]:
    return deepcopy(_V1_NODE_CATALOG)
