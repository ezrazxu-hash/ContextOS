from dataclasses import dataclass
import re

from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.manifest.schema import EdgeSpec
from contextos.template.manifest.schema import NodeSpec
from contextos.template.manifest.schema import TemplateManifest
from contextos.tool.registry.registry import ToolRegistry


SUPPORTED_NODE_TYPES = {"prompt", "llm", "tool", "condition", "output"}
RESERVED_UNSUPPORTED_NODE_TYPES = {"agent", "router"}
BOUNDARY_NODE_TYPES = {"start", "end"}
CONDITION_OPERATORS = {"eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists", "is_empty", "is_true", "is_false"}
_STATE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class ManifestValidationError(ValueError):
    def __init__(self, code: str, field_path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field_path = field_path


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    field: str
    node_id: str | None = None
    edge_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "node_id": self.node_id,
            "edge_id": self.edge_id,
            "field": self.field,
            "message": self.message,
        }


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]

    def to_dict(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "errors": [issue.to_dict() for issue in self.errors],
            "warnings": [issue.to_dict() for issue in self.warnings],
        }


class ManifestValidator:
    def __init__(self, extension_registry: ExtensionRegistry, tool_registry: ToolRegistry) -> None:
        self._extension_registry = extension_registry
        self._tool_registry = tool_registry

    def validate(self, manifest: TemplateManifest) -> list[object]:
        result = self.validate_result(manifest)
        if result.errors:
            first = result.errors[0]
            raise ManifestValidationError(first.code, first.field, first.message)
        return []

    def validate_result(self, manifest: TemplateManifest) -> ValidationResult:
        errors: list[ValidationIssue] = []
        errors.extend(self._edge_issues(manifest))
        errors.extend(self._node_issues(manifest))
        errors.extend(self._graph_shape_issues(manifest))
        return ValidationResult(valid=not errors, errors=errors, warnings=[])

    def _edge_issues(self, manifest: TemplateManifest) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        node_ids = {node.id for node in manifest.graph.nodes}
        allowed_boundary_nodes = {"START", "END"}
        for index, edge in enumerate(manifest.graph.edges):
            if edge.source not in node_ids and edge.source not in allowed_boundary_nodes:
                issues.append(
                    ValidationIssue(
                        code="unknown_node",
                        field=f"graph.edges[{index}].from",
                        message=f"Edge references unknown source node: {edge.source}",
                        edge_id=_edge_id(index, edge),
                    )
                )
            if edge.target not in node_ids and edge.target not in allowed_boundary_nodes:
                issues.append(
                    ValidationIssue(
                        code="unknown_node",
                        field=f"graph.edges[{index}].to",
                        message=f"Edge references unknown target node: {edge.target}",
                        edge_id=_edge_id(index, edge),
                    )
                )
        return issues

    def _node_issues(self, manifest: TemplateManifest) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        for index, node in enumerate(manifest.graph.nodes):
            if node.id in {"START", "END"} or node.type in BOUNDARY_NODE_TYPES:
                issues.append(
                    ValidationIssue(
                        code="reserved_boundary_node",
                        field=f"graph.nodes[{index}].type",
                        message="START and END are system boundary nodes and cannot be declared in manifest nodes",
                        node_id=node.id,
                    )
                )
                continue
            if node.type in RESERVED_UNSUPPORTED_NODE_TYPES or node.type not in SUPPORTED_NODE_TYPES:
                issues.append(
                    ValidationIssue(
                        code="unsupported_node_type",
                        field=f"graph.nodes[{index}].type",
                        message=f"Workflow node type is not supported for publish: {node.type}",
                        node_id=node.id,
                    )
                )
                continue
            if node.type == "prompt":
                issues.extend(_prompt_config_issues(node, index))
            if node.type == "llm":
                from contextos.template.nodes.llm_schema import validate_llm_node_config

                issues.extend(
                    validate_llm_node_config(
                        node.config,
                        field_prefix=f"graph.nodes[{index}].config",
                        node_id=node.id,
                    )
                )
            if node.type == "tool":
                issues.extend(_tool_config_issues(node, index, self._tool_registry))
            if node.type == "condition":
                issues.extend(_condition_config_issues(node, index))
            if node.type == "output":
                issues.extend(_output_config_issues(node, index))
            for tool_index, tool_id in enumerate(node.config.get("tools", [])):
                if not self._tool_registry.has(str(tool_id)):
                    issues.append(
                        ValidationIssue(
                            code="unknown_tool",
                            field=f"graph.nodes[{index}].config.tools[{tool_index}]",
                            message=f"Tool binding is not registered: {tool_id}",
                            node_id=node.id,
                        )
                    )
        return issues

    def _graph_shape_issues(self, manifest: TemplateManifest) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        edges = manifest.graph.edges
        if not any(edge.source == "START" for edge in edges):
            issues.append(ValidationIssue("missing_start_edge", "Graph must have an outgoing START edge", "graph.edges"))
        if not any(edge.target == "END" for edge in edges):
            issues.append(ValidationIssue("missing_end_edge", "Graph must have an incoming END edge", "graph.edges"))

        incoming = {node.id: 0 for node in manifest.graph.nodes}
        outgoing = {node.id: 0 for node in manifest.graph.nodes}
        for edge in edges:
            if edge.target in incoming:
                incoming[edge.target] += 1
            if edge.source in outgoing:
                outgoing[edge.source] += 1

        for index, node in enumerate(manifest.graph.nodes):
            if incoming[node.id] == 0 and outgoing[node.id] == 0:
                issues.append(
                    ValidationIssue(
                        "isolated_node",
                        f"Node is not connected: {node.id}",
                        f"graph.nodes[{index}]",
                        node_id=node.id,
                    )
                )

        start_edges = [edge for edge in edges if edge.source == "START"]
        end_edges = [edge for edge in edges if edge.target == "END"]
        if len(start_edges) > 1:
            issues.append(ValidationIssue("multiple_start_edges", "Graph must have exactly one outgoing START edge", "graph.edges"))
        if len(end_edges) > 1:
            issues.append(ValidationIssue("multiple_end_edges", "Graph must have exactly one incoming END edge", "graph.edges"))
        for index, edge in enumerate(edges):
            if edge.target == "START":
                issues.append(
                    ValidationIssue(
                        "invalid_start_connection",
                        "START cannot have incoming edges",
                        f"graph.edges[{index}].target",
                        edge_id=_edge_id(index, edge),
                    )
                )
            if edge.source == "END":
                issues.append(
                    ValidationIssue(
                        "invalid_end_connection",
                        "END cannot have outgoing edges",
                        f"graph.edges[{index}].source",
                        edge_id=_edge_id(index, edge),
                    )
                )

        node_by_id = {node.id: node for node in manifest.graph.nodes}
        for index, node in enumerate(manifest.graph.nodes):
            if node.type != "condition":
                continue
            routes = {edge.condition for edge in edges if edge.source == node.id and edge.condition is not None}
            if routes != {"true", "false"}:
                issues.append(
                    ValidationIssue(
                        "condition_routes_required",
                        "Condition nodes must declare true and false outgoing routes",
                        f"graph.nodes[{index}]",
                        node_id=node.id,
                    )
                )
        for index, edge in enumerate(edges):
            if edge.condition is None:
                continue
            source_node = node_by_id.get(edge.source)
            if source_node and source_node.type == "condition" and edge.condition not in {"true", "false"}:
                issues.append(
                    ValidationIssue(
                        "condition_route_invalid",
                        "Condition route must be true or false",
                        f"graph.edges[{index}].condition",
                        node_id=edge.source,
                        edge_id=_edge_id(index, edge),
                    )
                )

        reachable = _reachable_from_start(edges)
        for index, node in enumerate(manifest.graph.nodes):
            if node.type == "output" and node.id not in reachable:
                issues.append(
                    ValidationIssue(
                        "output_not_reachable",
                        f"Output node is not reachable from START: {node.id}",
                        f"graph.nodes[{index}]",
                        node_id=node.id,
                    )
                )
        return issues


def _edge_id(index: int, edge: EdgeSpec) -> str:
    if edge.id is not None:
        return edge.id
    suffix = f":{edge.condition}" if edge.condition else ""
    return f"{index}:{edge.source}->{edge.target}{suffix}"


def _reachable_from_start(edges: list[EdgeSpec]) -> set[str]:
    next_by_source: dict[str, list[str]] = {}
    for edge in edges:
        next_by_source.setdefault(edge.source, []).append(edge.target)

    seen: set[str] = set()
    stack = list(next_by_source.get("START", []))
    while stack:
        node_id = stack.pop()
        if node_id in seen:
            continue
        seen.add(node_id)
        stack.extend(next_by_source.get(node_id, []))
    return seen


def _prompt_config_issues(node: NodeSpec, index: int) -> list[ValidationIssue]:
    return _required_config_issues(node, index, "prompt_config", ["template", "output_key"]) + _output_key_issues(
        node,
        index,
        "prompt_config",
    )


def _tool_config_issues(node: NodeSpec, index: int, tool_registry: ToolRegistry) -> list[ValidationIssue]:
    issues = _required_config_issues(node, index, "tool_config", ["tool_name", "output_key"])
    issues.extend(_output_key_issues(node, index, "tool_config"))
    tool_name = node.config.get("tool_name")
    if tool_name and not tool_registry.has(str(tool_name)):
        issues.append(
            ValidationIssue(
                code="unknown_tool",
                field=f"graph.nodes[{index}].config.tool_name",
                message=f"Tool is not registered: {tool_name}",
                node_id=node.id,
            )
        )
    return issues


def _condition_config_issues(node: NodeSpec, index: int) -> list[ValidationIssue]:
    issues = _required_config_issues(node, index, "condition_config", ["source", "operator"])
    operator = node.config.get("operator")
    if operator and str(operator) not in CONDITION_OPERATORS:
        issues.append(
            ValidationIssue(
                code="condition_config.invalid_operator",
                field=f"graph.nodes[{index}].config.operator",
                message=f"Condition operator is not supported: {operator}",
                node_id=node.id,
            )
        )
    return issues


def _output_config_issues(node: NodeSpec, index: int) -> list[ValidationIssue]:
    return _required_config_issues(node, index, "output_config", ["source"])


def _required_config_issues(node: NodeSpec, index: int, code_prefix: str, fields: list[str]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for field in fields:
        if not node.config.get(field):
            issues.append(
                ValidationIssue(
                    code=f"{code_prefix}.required",
                    field=f"graph.nodes[{index}].config.{field}",
                    message=f"{node.type} node config field is required: {field}",
                    node_id=node.id,
                )
            )
    return issues


def _output_key_issues(node: NodeSpec, index: int, code_prefix: str) -> list[ValidationIssue]:
    output_key = node.config.get("output_key")
    if output_key and not _STATE_KEY_RE.match(str(output_key)):
        return [
            ValidationIssue(
                code=f"{code_prefix}.invalid_output_key",
                field=f"graph.nodes[{index}].config.output_key",
                message=f"{node.type} node output_key must be a simple state key",
                node_id=node.id,
            )
        ]
    return []
