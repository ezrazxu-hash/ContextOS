from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from contextos.workflow_v2.domain.agent_node import (
    AGENT_NODE_VISIBILITIES,
    LEGACY_AGENT_NODE_FIELDS,
    agent_node_config,
)
from contextos.workflow_v2.application.json_schema import WorkflowV2JsonSchemaService
from contextos.workflow_v2.domain.definitions import V2_WORKFLOW_NODE_TYPES
from contextos.tool.registry.registry import ToolRegistry

BOUNDARY_NODES = {"START", "END"}
TOOL_POLICY_MODES = frozenset({"auto", "required", "disabled"})


class WorkflowV2DefinitionValidator:
    def __init__(self, tool_registry: ToolRegistry | None = None) -> None:
        self._tool_registry = tool_registry

    def validate(self, definition: dict[str, object]) -> dict[str, object]:
        nodes = definition.get("nodes", [])
        edges = definition.get("edges", [])
        errors: list[dict[str, object]] = []
        if not isinstance(nodes, list):
            return {"valid": False, "errors": [_issue("nodes_invalid", "nodes", "Nodes must be a list")], "warnings": []}
        if not isinstance(edges, list):
            return {"valid": False, "errors": [_issue("edges_invalid", "edges", "Edges must be a list")], "warnings": []}

        workflow_tool_ids = _workflow_tool_ids(definition)
        errors.extend(_validate_workflow_tools(definition, workflow_tool_ids, self._tool_registry))
        node_ids = [str(node.get("id")) for node in nodes if isinstance(node, dict) and node.get("id")]
        node_by_id = {str(node.get("id")): node for node in nodes if isinstance(node, dict) and node.get("id")}
        counts = Counter(node_ids)
        for node_id, count in counts.items():
            if count > 1:
                errors.append(_issue("duplicate_node_id", "nodes", f"Duplicate node id: {node_id}", node_id=node_id))

        for index, node in enumerate(nodes):
            if not isinstance(node, dict):
                errors.append(_issue("node_invalid", f"nodes[{index}]", "Node must be an object"))
                continue
            node_type = node.get("type")
            if node_type not in V2_WORKFLOW_NODE_TYPES:
                errors.append(_issue("unsupported_node_type", f"nodes[{index}].type", f"Unsupported V2 workflow node type: {node_type}"))
            if node_type == "agent":
                errors.extend(_validate_agent_node(node, index, workflow_tool_ids, self._tool_registry))
            if node_type == "condition":
                errors.extend(_validate_condition_node(node, index, node_by_id))

        if not any(isinstance(node, dict) and node.get("type") == "end" for node in nodes):
            errors.append(_issue("missing_end_node", "nodes", "At least one End node is required"))

        outgoing_by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
        condition_handles: dict[str, set[str]] = defaultdict(set)
        valid_node_ids = set(node_by_id) | BOUNDARY_NODES
        for index, edge in enumerate(edges):
            if not isinstance(edge, dict):
                errors.append(_issue("edge_invalid", f"edges[{index}]", "Edge must be an object"))
                continue
            source = _edge_endpoint(edge, "source")
            target = _edge_endpoint(edge, "target")
            field = f"edges[{index}]"
            if source not in valid_node_ids:
                errors.append(_issue("unknown_node", f"{field}.source", f"Unknown edge source: {source}"))
            if target not in valid_node_ids:
                errors.append(_issue("unknown_node", f"{field}.target", f"Unknown edge target: {target}"))
            if source == target:
                errors.append(_issue("self_connection", field, "Workflow node cannot connect to itself"))
            if target == "START":
                errors.append(_issue("start_has_incoming_edge", f"{field}.target", "START cannot have incoming edges"))

            source_node = node_by_id.get(source)
            if source == "END" or source_node and source_node.get("type") == "end":
                errors.append(_issue("end_has_outgoing_edge", f"{field}.source", "End nodes cannot have outgoing edges"))

            if source_node and source_node.get("type") in {"agent", "workflow"}:
                handle = _edge_handle(edge)
                if handle in {"", "success", "out"}:
                    outgoing_by_source[source].append(edge)

            if source_node and source_node.get("type") == "condition":
                handle = _edge_handle(edge)
                if handle in condition_handles[source]:
                    errors.append(_issue("duplicate_condition_branch", f"{field}.sourceHandle", f"Duplicate condition branch: {handle}"))
                condition_handles[source].add(handle)

        for source, outgoing in outgoing_by_source.items():
            if len(outgoing) > 1:
                errors.append(_issue("multiple_success_edges", "edges", f"Node {source} has multiple success edges", node_id=source))

        return {"valid": len(errors) == 0, "errors": errors, "warnings": []}


def _edge_endpoint(edge: dict[str, Any], key: str) -> str:
    if key == "source":
        return str(edge.get("source", edge.get("from", "")))
    return str(edge.get("target", edge.get("to", "")))


def _edge_handle(edge: dict[str, Any]) -> str:
    return str(edge.get("sourceHandle", edge.get("source_handle", edge.get("route", edge.get("condition", "")))))


def _validate_agent_node(
    node: dict[str, Any],
    index: int,
    workflow_tool_ids: set[str],
    tool_registry: ToolRegistry | None,
) -> list[dict[str, object]]:
    errors: list[dict[str, object]] = []
    config = agent_node_config(node)
    node_id = str(node.get("id") or "")

    instruction = config.get("instruction", "")
    if not isinstance(instruction, str) or not instruction.strip():
        errors.append(_issue("agent_instruction_required", f"nodes[{index}].config.instruction", "Agent node instruction is required", node_id=node_id))

    visibility = str(config.get("visibility", "visible")).lower()
    if visibility not in AGENT_NODE_VISIBILITIES:
        errors.append(_issue("invalid_agent_visibility", f"nodes[{index}].config.visibility", f"Invalid agent node visibility: {config.get('visibility')}", node_id=node_id))

    for field in LEGACY_AGENT_NODE_FIELDS:
        if field in config:
            errors.append(_issue("legacy_agent_field", f"nodes[{index}].config.{field}", f"Legacy Agent node field is not allowed: {field}", node_id=node_id))

    retry_policy = config.get("retryPolicy", config.get("retry_policy", {}))
    if isinstance(retry_policy, dict):
        for field in ("schemaRetryCount", "nodeRetryCount", "timeoutMs"):
            if field in retry_policy and not _is_non_negative_number(retry_policy[field]):
                errors.append(_issue("invalid_retry_policy", f"nodes[{index}].config.retryPolicy.{field}", f"Retry policy value must be non-negative: {field}", node_id=node_id))
    elif retry_policy:
        errors.append(_issue("invalid_retry_policy", f"nodes[{index}].config.retryPolicy", "Retry policy must be an object", node_id=node_id))

    output_schema = config.get("outputSchema", config.get("output_schema"))
    if output_schema is not None:
        schema_result = WorkflowV2JsonSchemaService().validate_schema(output_schema)
        for error in schema_result["errors"]:
            errors.append(
                _issue(
                    "invalid_output_schema",
                    _schema_field_path(index, str(error["path"])),
                    str(error["message"]),
                    node_id=node_id,
                )
            )

    errors.extend(_validate_tool_policy(config.get("toolPolicy", config.get("tool_policy", {})), index, workflow_tool_ids, tool_registry, node_id))
    return errors


def _validate_condition_node(
    node: dict[str, Any],
    index: int,
    node_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, object]]:
    config = node.get("config", {})
    if not isinstance(config, dict):
        return [_issue("invalid_condition_config", f"nodes[{index}].config", "Condition config must be an object", node_id=str(node.get("id") or ""))]
    branches = config.get("branches", [])
    if branches is None:
        branches = []
    if not isinstance(branches, list):
        return [_issue("invalid_condition_branches", f"nodes[{index}].config.branches", "Condition branches must be a list", node_id=str(node.get("id") or ""))]
    errors: list[dict[str, object]] = []
    for branch_index, branch in enumerate(branches):
        if not isinstance(branch, dict):
            errors.append(_issue("invalid_condition_branch", f"nodes[{index}].config.branches[{branch_index}]", "Condition branch must be an object", node_id=str(node.get("id") or "")))
            continue
        source = branch.get("source", {})
        if not isinstance(source, dict):
            errors.append(_issue("invalid_condition_source", f"nodes[{index}].config.branches[{branch_index}].source", "Condition branch source must be an object", node_id=str(node.get("id") or "")))
            continue
        source_node_id = str(source.get("nodeId", source.get("node_id", "")))
        source_node = node_by_id.get(source_node_id)
        if not source_node or source_node.get("type") != "agent":
            errors.append(_issue("condition_source_not_agent", f"nodes[{index}].config.branches[{branch_index}].source.nodeId", f"Condition source must be an Agent node with output schema: {source_node_id}", node_id=str(node.get("id") or "")))
            continue
        path = source.get("path", [])
        if not isinstance(path, list) or not path:
            errors.append(_issue("condition_source_path_required", f"nodes[{index}].config.branches[{branch_index}].source.path", "Condition source path is required", node_id=str(node.get("id") or "")))
            continue
        output_schema = source_node.get("config", {}).get("outputSchema", source_node.get("config", {}).get("output_schema")) if isinstance(source_node.get("config", {}), dict) else None
        if not _schema_path_exists(output_schema, [str(item) for item in path]):
            errors.append(_issue("condition_source_field_not_found", f"nodes[{index}].config.branches[{branch_index}].source.path", f"Condition source field is not defined by output schema: {source_node_id}.{'.'.join(str(item) for item in path)}", node_id=str(node.get("id") or "")))
    return errors


def _schema_path_exists(schema: Any, path: list[str]) -> bool:
    current = schema
    for segment in path:
        if not isinstance(current, dict) or current.get("type") != "object":
            return False
        properties = current.get("properties", {})
        if not isinstance(properties, dict) or segment not in properties:
            return False
        current = properties[segment]
    return isinstance(current, dict)


def _workflow_tool_ids(definition: dict[str, object]) -> set[str]:
    tools = definition.get("tools", [])
    if not isinstance(tools, list):
        return set()
    ids: set[str] = set()
    for tool in tools:
        if isinstance(tool, str):
            ids.add(tool)
        elif isinstance(tool, dict):
            value = tool.get("id", tool.get("toolId", tool.get("tool_id")))
            if value:
                ids.add(str(value))
    return ids


def _validate_workflow_tools(
    definition: dict[str, object],
    workflow_tool_ids: set[str],
    tool_registry: ToolRegistry | None,
) -> list[dict[str, object]]:
    errors: list[dict[str, object]] = []
    tools = definition.get("tools", [])
    if tools is not None and not isinstance(tools, list):
        return [_issue("workflow_tools_invalid", "tools", "Workflow tools must be a list")]
    if tool_registry is None:
        return errors
    for index, tool_id in enumerate(workflow_tool_ids):
        if not tool_registry.has(tool_id):
            errors.append(_issue("unknown_workflow_tool", f"tools[{index}]", f"Unknown workflow tool: {tool_id}"))
    return errors


def _validate_tool_policy(
    policy: Any,
    node_index: int,
    workflow_tool_ids: set[str],
    tool_registry: ToolRegistry | None,
    node_id: str,
) -> list[dict[str, object]]:
    if policy is None:
        policy = {}
    if not isinstance(policy, dict):
        return [_issue("invalid_tool_policy", f"nodes[{node_index}].config.toolPolicy", "Tool policy must be an object", node_id=node_id)]

    errors: list[dict[str, object]] = []
    mode = str(policy.get("mode", "disabled")).lower()
    if mode not in TOOL_POLICY_MODES:
        errors.append(_issue("invalid_tool_policy_mode", f"nodes[{node_index}].config.toolPolicy.mode", f"Invalid tool policy mode: {policy.get('mode')}", node_id=node_id))

    allowed_tools = _tool_id_list(policy.get("allowedTools", policy.get("allowed_tools", [])))
    required_tools = _tool_id_list(policy.get("requiredTools", policy.get("required_tools", [])))
    if mode == "disabled" and (allowed_tools or required_tools):
        errors.append(_issue("disabled_tool_policy_has_tools", f"nodes[{node_index}].config.toolPolicy", "Disabled tool policy cannot configure allowed or required tools", node_id=node_id))

    for field_name, tool_ids in (("allowedTools", allowed_tools), ("requiredTools", required_tools)):
        for tool_index, tool_id in enumerate(tool_ids):
            field = f"nodes[{node_index}].config.toolPolicy.{field_name}[{tool_index}]"
            if tool_id not in workflow_tool_ids:
                errors.append(_issue("node_tool_not_in_workflow_registry", field, f"Node tool is not enabled in the workflow registry: {tool_id}", node_id=node_id))
            if tool_registry is not None and not tool_registry.has(tool_id):
                errors.append(_issue("unknown_agent_tool", field, f"Unknown agent tool: {tool_id}", node_id=node_id))

    allowed_set = set(allowed_tools)
    for tool_index, tool_id in enumerate(required_tools):
        if tool_id not in allowed_set:
            errors.append(
                _issue(
                    "required_tool_not_allowed",
                    f"nodes[{node_index}].config.toolPolicy.requiredTools[{tool_index}]",
                    f"Required tool must also be allowed: {tool_id}",
                    node_id=node_id,
                )
            )
    return errors


def _tool_id_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item]


def _is_non_negative_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0


def _schema_field_path(node_index: int, schema_path: str) -> str:
    suffix = schema_path.removeprefix("$")
    suffix = suffix.removeprefix(".")
    base = f"nodes[{node_index}].config.outputSchema"
    return f"{base}.{suffix}" if suffix else base


def _issue(code: str, field: str, message: str, *, node_id: str | None = None) -> dict[str, object]:
    issue: dict[str, object] = {"code": code, "field": field, "message": message}
    if node_id is not None:
        issue["node_id"] = node_id
    return issue
