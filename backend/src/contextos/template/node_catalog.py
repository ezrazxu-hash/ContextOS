from __future__ import annotations

from copy import deepcopy


_V1_NODE_CATALOG: list[dict[str, object]] = [
    {
        "type": "prompt",
        "display_name": "PROMPT",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.template", "config.output_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "llm",
        "display_name": "LLM",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.model", "config.prompt", "config.output_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "tool",
        "display_name": "TOOL",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.tool_name", "config.output_key"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "condition",
        "display_name": "CONDITION",
        "ports": {"inputs": ["in"], "outputs": ["true", "false"]},
        "required_fields": ["config.source", "config.operator"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "output",
        "display_name": "OUTPUT",
        "ports": {"inputs": ["in"], "outputs": ["out"]},
        "required_fields": ["config.source"],
        "connectable": {"incoming": True, "outgoing": True},
    },
]


def list_node_catalog() -> list[dict[str, object]]:
    return deepcopy(_V1_NODE_CATALOG)
