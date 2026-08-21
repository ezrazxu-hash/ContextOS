from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.manifest.schema import TemplateManifest
from contextos.tool.registry.registry import ToolRegistry


class ManifestValidationError(ValueError):
    def __init__(self, code: str, field_path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field_path = field_path


class ManifestValidator:
    def __init__(self, extension_registry: ExtensionRegistry, tool_registry: ToolRegistry) -> None:
        self._extension_registry = extension_registry
        self._tool_registry = tool_registry

    def validate(self, manifest: TemplateManifest) -> list[object]:
        self._validate_edges(manifest)
        self._validate_nodes(manifest)
        return []

    def _validate_edges(self, manifest: TemplateManifest) -> None:
        node_ids = {node.id for node in manifest.graph.nodes}
        allowed_boundary_nodes = {"START", "END"}
        for index, edge in enumerate(manifest.graph.edges):
            if edge.source not in node_ids and edge.source not in allowed_boundary_nodes:
                raise ManifestValidationError(
                    "unknown_node",
                    f"graph.edges[{index}].from",
                    f"Edge references unknown source node: {edge.source}",
                )
            if edge.target not in node_ids and edge.target not in allowed_boundary_nodes:
                raise ManifestValidationError(
                    "unknown_node",
                    f"graph.edges[{index}].to",
                    f"Edge references unknown target node: {edge.target}",
                )

    def _validate_nodes(self, manifest: TemplateManifest) -> None:
        for index, node in enumerate(manifest.graph.nodes):
            if node.type == "custom" and (node.extension is None or not self._extension_registry.has_custom_node(node.extension)):
                raise ManifestValidationError(
                    "unknown_extension",
                    f"graph.nodes[{index}].extension",
                    f"Custom node extension is not registered: {node.extension}",
                )
            for tool_index, tool_id in enumerate(node.config.get("tools", [])):
                if not self._tool_registry.has(str(tool_id)):
                    raise ManifestValidationError(
                        "unknown_tool",
                        f"graph.nodes[{index}].config.tools[{tool_index}]",
                        f"Tool binding is not registered: {tool_id}",
                    )
