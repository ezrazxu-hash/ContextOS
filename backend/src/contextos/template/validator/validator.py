from dataclasses import dataclass

from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.manifest.schema import EdgeSpec
from contextos.template.manifest.schema import TemplateManifest
from contextos.tool.registry.registry import ToolRegistry


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
            if node.type == "llm":
                from contextos.template.nodes.llm_schema import validate_llm_node_config

                issues.extend(
                    validate_llm_node_config(
                        node.config,
                        field_prefix=f"graph.nodes[{index}].config",
                        node_id=node.id,
                    )
                )
            if node.type == "agent" and _uses_agent_v1_config(node.config):
                from contextos.template.nodes.agent_schema import validate_agent_node_config

                issues.extend(
                    validate_agent_node_config(
                        node.config,
                        field_prefix=f"graph.nodes[{index}].config",
                        node_id=node.id,
                    )
                )
            if node.type == "custom" and (node.extension is None or not self._extension_registry.has_custom_node(node.extension)):
                issues.append(
                    ValidationIssue(
                        code="unknown_extension",
                        field=f"graph.nodes[{index}].extension",
                        message=f"Custom node extension is not registered: {node.extension}",
                        node_id=node.id,
                    )
                )
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


def _uses_agent_v1_config(config: dict[str, object]) -> bool:
    return any(field in config for field in ("model", "instruction", "output_key", "input", "context_policy", "max_steps", "tool_loop"))
