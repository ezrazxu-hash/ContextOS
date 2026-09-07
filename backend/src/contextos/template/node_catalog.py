from __future__ import annotations

from copy import deepcopy


_V2_NODE_CATALOG: list[dict[str, object]] = [
    {
        "type": "agent",
        "display_name": "AGENT",
        "ports": {"inputs": ["in"], "outputs": ["success"]},
        "required_fields": ["config.instruction"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "condition",
        "display_name": "CONDITION",
        "ports": {"inputs": ["in"], "outputs": ["branch", "default"]},
        "required_fields": ["config.branches"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "workflow",
        "display_name": "WORKFLOW",
        "ports": {"inputs": ["in"], "outputs": ["success"]},
        "required_fields": ["config.workflowId", "config.version"],
        "connectable": {"incoming": True, "outgoing": True},
    },
    {
        "type": "end",
        "display_name": "END",
        "ports": {"inputs": ["in"], "outputs": []},
        "required_fields": [],
        "connectable": {"incoming": True, "outgoing": False},
    },
]


def list_node_catalog() -> list[dict[str, object]]:
    return deepcopy(_V2_NODE_CATALOG)
