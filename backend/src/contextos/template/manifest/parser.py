from typing import Any

from contextos.template.manifest.schema import (
    CheckpointSpec,
    ContextBudgetSpec,
    ContextRestoreSpec,
    ContextSpec,
    EdgeSpec,
    GraphSpec,
    NodeSpec,
    TemplateInfo,
    TemplateManifest,
    UiSpec,
)

SUPPORTED_SCHEMA_VERSION = "1.0"


class ManifestParseError(ValueError):
    def __init__(self, field_path: str, message: str) -> None:
        super().__init__(message)
        self.field_path = field_path


def parse_manifest(payload: dict[str, Any]) -> TemplateManifest:
    if "schema_version" in payload or "runtime" in payload:
        return _parse_runtime_manifest(payload)
    return _parse_legacy_manifest(payload)


def _parse_legacy_manifest(payload: dict[str, Any]) -> TemplateManifest:
    _reject_unknown(payload, {"template", "graph", "context", "checkpoint", "ui"}, "")
    graph = _parse_graph(_required(payload, "graph"))
    return TemplateManifest(
        template=_parse_template(_required(payload, "template")),
        graph=graph,
        context=_parse_context(_required(payload, "context")),
        checkpoint=_parse_checkpoint(_required(payload, "checkpoint")),
        ui=_parse_ui(_required(payload, "ui")),
    )


def _parse_runtime_manifest(payload: dict[str, Any]) -> TemplateManifest:
    _reject_unknown(payload, {"schema_version", "runtime", "ui", "template", "context", "checkpoint"}, "")
    schema_version = str(_required(payload, "schema_version"))
    if schema_version != SUPPORTED_SCHEMA_VERSION:
        raise ManifestParseError("schema_version", f"Unsupported manifest schema_version: {schema_version}")

    return TemplateManifest(
        template=_parse_template(payload.get("template", {"id": "", "name": "", "version": ""})),
        graph=_parse_runtime(_required(payload, "runtime")),
        context=_parse_context(
            payload.get(
                "context",
                {
                    "policy": "balanced",
                    "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
                    "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
                },
            )
        ),
        checkpoint=_parse_checkpoint(payload.get("checkpoint", {"enabled": True})),
        ui=_parse_contract_ui(_required(payload, "ui")),
        schema_version=schema_version,
    )


def _parse_template(payload: dict[str, Any]) -> TemplateInfo:
    _reject_unknown(payload, {"id", "name", "version"}, "template")
    return TemplateInfo(
        id=str(_required(payload, "id", "template")),
        name=str(_required(payload, "name", "template")),
        version=str(_required(payload, "version", "template")),
    )


def _parse_graph(payload: dict[str, Any]) -> GraphSpec:
    _reject_unknown(payload, {"state_schema", "nodes", "edges"}, "graph")
    nodes = [_parse_node(node, index) for index, node in enumerate(_required(payload, "nodes", "graph"))]
    _reject_duplicate_node_ids(nodes, "graph.nodes")
    return GraphSpec(
        state_schema=str(_required(payload, "state_schema", "graph")),
        nodes=nodes,
        edges=[_parse_edge(edge, index) for index, edge in enumerate(_required(payload, "edges", "graph"))],
    )


def _parse_runtime(payload: dict[str, Any]) -> GraphSpec:
    _reject_unknown(payload, {"nodes", "edges", "state_schema"}, "runtime")
    nodes = [_parse_runtime_node(node, index) for index, node in enumerate(_required(payload, "nodes", "runtime"))]
    _reject_duplicate_node_ids(nodes, "runtime.nodes")
    return GraphSpec(
        state_schema=str(payload.get("state_schema", "default_chat_state")),
        nodes=nodes,
        edges=[_parse_runtime_edge(edge, index) for index, edge in enumerate(_required(payload, "edges", "runtime"))],
    )


def _parse_node(payload: dict[str, Any], index: int) -> NodeSpec:
    path = f"graph.nodes[{index}]"
    _reject_unknown(payload, {"id", "type", "config", "position", "extension"}, path)
    return NodeSpec(
        id=str(_required(payload, "id", path)),
        type=str(_required(payload, "type", path)),
        name=None,
        config=dict(payload.get("config", {})),
        position=dict(payload["position"]) if payload.get("position") is not None else None,
        extension=str(payload["extension"]) if payload.get("extension") is not None else None,
    )


def _parse_runtime_node(payload: dict[str, Any], index: int) -> NodeSpec:
    path = f"runtime.nodes[{index}]"
    _reject_unknown(payload, {"id", "type", "name", "config", "extension"}, path)
    return NodeSpec(
        id=str(_required(payload, "id", path)),
        type=str(_required(payload, "type", path)),
        name=str(payload["name"]) if payload.get("name") is not None else None,
        config=dict(payload.get("config", {})),
        extension=str(payload["extension"]) if payload.get("extension") is not None else None,
    )


def _parse_edge(payload: dict[str, Any], index: int) -> EdgeSpec:
    path = f"graph.edges[{index}]"
    _reject_unknown(payload, {"from", "to", "condition"}, path)
    return EdgeSpec(
        source=str(_required(payload, "from", path)),
        target=str(_required(payload, "to", path)),
        condition=str(payload["condition"]) if payload.get("condition") is not None else None,
    )


def _parse_runtime_edge(payload: dict[str, Any], index: int) -> EdgeSpec:
    path = f"runtime.edges[{index}]"
    _reject_unknown(payload, {"id", "source", "target", "source_handle", "target_handle", "route"}, path)
    route = str(payload["route"]) if payload.get("route") is not None else None
    return EdgeSpec(
        id=str(payload["id"]) if payload.get("id") is not None else None,
        source=str(_required(payload, "source", path)),
        target=str(_required(payload, "target", path)),
        condition=route,
        source_handle=str(payload["source_handle"]) if payload.get("source_handle") is not None else None,
        target_handle=str(payload["target_handle"]) if payload.get("target_handle") is not None else None,
        route=route,
    )


def _parse_context(payload: dict[str, Any]) -> ContextSpec:
    _reject_unknown(payload, {"policy", "budget", "restore"}, "context")
    return ContextSpec(
        policy=str(_required(payload, "policy", "context")),
        budget=_parse_budget(_required(payload, "budget", "context")),
        restore=_parse_restore(_required(payload, "restore", "context")),
    )


def _parse_budget(payload: dict[str, Any]) -> ContextBudgetSpec:
    _reject_unknown(payload, {"high_watermark", "target_watermark"}, "context.budget")
    return ContextBudgetSpec(
        high_watermark=float(_required(payload, "high_watermark", "context.budget")),
        target_watermark=float(_required(payload, "target_watermark", "context.budget")),
    )


def _parse_restore(payload: dict[str, Any]) -> ContextRestoreSpec:
    _reject_unknown(payload, {"mode", "max_tokens_per_restore", "max_restore_per_turn"}, "context.restore")
    return ContextRestoreSpec(
        mode=str(_required(payload, "mode", "context.restore")),
        max_tokens_per_restore=int(_required(payload, "max_tokens_per_restore", "context.restore")),
        max_restore_per_turn=int(_required(payload, "max_restore_per_turn", "context.restore")),
    )


def _parse_checkpoint(payload: dict[str, Any]) -> CheckpointSpec:
    _reject_unknown(payload, {"enabled"}, "checkpoint")
    return CheckpointSpec(enabled=bool(_required(payload, "enabled", "checkpoint")))


def _parse_ui(payload: dict[str, Any]) -> UiSpec:
    _reject_unknown(payload, {"editable_messages", "expose_context_panel"}, "ui")
    return UiSpec(
        editable_messages=bool(_required(payload, "editable_messages", "ui")),
        expose_context_panel=bool(_required(payload, "expose_context_panel", "ui")),
    )


def _parse_contract_ui(payload: dict[str, Any]) -> UiSpec:
    _reject_unknown(payload, {"nodes", "viewport"}, "ui")
    return UiSpec(
        nodes=dict(payload.get("nodes", {})),
        viewport=dict(payload.get("viewport", {})),
    )


def _required(payload: dict[str, Any], field: str, path: str = "") -> Any:
    if field not in payload:
        field_path = f"{path}.{field}" if path else field
        raise ManifestParseError(field_path, f"Missing required manifest field: {field_path}")
    return payload[field]


def _reject_unknown(payload: dict[str, Any], allowed: set[str], path: str) -> None:
    for field in payload:
        if field not in allowed:
            field_path = f"{path}.{field}" if path else field
            raise ManifestParseError(field_path, f"Unsupported V1 manifest field: {field_path}")


def _reject_duplicate_node_ids(nodes: list[NodeSpec], path: str) -> None:
    seen: set[str] = set()
    for index, node in enumerate(nodes):
        if node.id in seen:
            raise ManifestParseError(f"{path}[{index}].id", f"Duplicate node id: {node.id}")
        seen.add(node.id)
