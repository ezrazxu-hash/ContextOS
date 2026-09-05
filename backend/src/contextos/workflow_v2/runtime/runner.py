from __future__ import annotations

from contextos.workflow_v2.domain.definitions import V2_WORKFLOW_NODE_TYPES, workflow_schema_version


class WorkflowV2Runner:
    def validate_entry(self, workflow_definition: dict[str, object]) -> None:
        if workflow_schema_version(workflow_definition) != 2:
            raise ValueError("WorkflowV2Runner requires schemaVersion=2")

        nodes = workflow_definition.get("nodes", [])
        if not isinstance(nodes, list):
            raise ValueError("V2 workflow nodes must be a list")

        for index, node in enumerate(nodes):
            if not isinstance(node, dict):
                raise ValueError(f"V2 workflow node at index {index} must be an object")
            node_type = node.get("type")
            if node_type not in V2_WORKFLOW_NODE_TYPES:
                raise ValueError(f"Unsupported V2 workflow node type: {node_type}")
