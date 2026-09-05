from __future__ import annotations

from copy import deepcopy

V2_WORKFLOW_NODE_TYPES = frozenset({"agent", "condition", "workflow", "end"})


def workflow_schema_version(payload: dict[str, object]) -> int:
    value = payload.get("schemaVersion", payload.get("schema_version"))
    if value in (2, "2", "2.0"):
        return 2
    return 1


def create_workflow_v2_definition(payload: dict[str, object]) -> dict[str, object]:
    workflow_id = str(payload.get("id") or "workflow")
    name = str(payload.get("name") or "Untitled Workflow")
    definition = deepcopy(payload)
    definition.update({
        "id": workflow_id,
        "name": name,
        "description": str(payload.get("description") or ""),
        "schemaVersion": 2,
        "nodes": deepcopy(payload.get("nodes")) if isinstance(payload.get("nodes"), list) else [],
        "edges": deepcopy(payload.get("edges")) if isinstance(payload.get("edges"), list) else [],
    })
    definition.setdefault("inputSchema", None)
    definition.setdefault("outputSchema", None)
    definition.setdefault("tools", [])
    definition.setdefault("runtimeLimits", {})
    return definition
