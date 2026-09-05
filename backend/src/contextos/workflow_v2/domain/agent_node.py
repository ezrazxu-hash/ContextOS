from __future__ import annotations

from copy import deepcopy
from typing import Any

AGENT_NODE_VISIBILITIES = frozenset({"hidden", "visible", "auto"})
LEGACY_AGENT_NODE_FIELDS = frozenset({
    "prompt",
    "promptTemplate",
    "prompt_template",
    "messageRole",
    "message_role",
    "messages",
    "llm",
    "llmNode",
    "llm_node",
    "modelConfig",
    "model_config",
})


def agent_node_config(node: dict[str, Any]) -> dict[str, Any]:
    config = node.get("config", {})
    if isinstance(config, dict):
        return deepcopy(config)
    return {}
