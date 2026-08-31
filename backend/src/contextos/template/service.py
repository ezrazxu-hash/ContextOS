from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.manifest.parser import parse_manifest
from contextos.template.validator.validator import ManifestValidationError, ManifestValidator
from contextos.tool.registry.registry import ToolRegistry


class TemplateNotFound(Exception):
    pass


class TemplateNodeNotFound(Exception):
    pass


@dataclass(frozen=True)
class TemplateRecord:
    template_id: str
    manifest_payload: dict[str, Any]
    draft_manifest_payload: dict[str, Any] | None = None
    draft_updated_at: str | None = None
    active_version_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {"id": self.template_id, "manifest": deepcopy(self.manifest_payload)}
        if self.active_version_id is not None:
            payload["active_version_id"] = self.active_version_id
        if self.draft_manifest_payload is not None:
            payload["draft_manifest"] = deepcopy(self.draft_manifest_payload)
            payload["draft_updated_at"] = self.draft_updated_at
        return payload


@dataclass(frozen=True)
class TemplateValidationResult:
    valid: bool
    issues: list[object]
    error: ManifestValidationError | None = None


class TemplateService:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._templates: dict[str, TemplateRecord] = {}

    def save(self, manifest_payload: dict[str, Any]) -> TemplateRecord:
        manifest = parse_manifest(manifest_payload)
        record = TemplateRecord(template_id=manifest.template.id, manifest_payload=deepcopy(manifest_payload))
        self._save_record(record)
        return record

    def update(self, template_id: str, manifest_payload: dict[str, Any]) -> TemplateRecord:
        manifest = parse_manifest(manifest_payload)
        record = TemplateRecord(template_id=template_id, manifest_payload=deepcopy(manifest_payload))
        self._save_record(record)
        if manifest.template.id != template_id:
            self._remove_record(template_id)
        return record

    def rename(self, template_id: str, name: str) -> TemplateRecord:
        record = self.get(template_id)
        manifest_payload = deepcopy(record.manifest_payload)
        manifest_payload.setdefault("template", {})["name"] = name
        draft_manifest_payload = deepcopy(record.draft_manifest_payload) if record.draft_manifest_payload is not None else None
        if draft_manifest_payload is not None:
            draft_manifest_payload.setdefault("template", {})["name"] = name
        updated = TemplateRecord(
            template_id=record.template_id,
            manifest_payload=manifest_payload,
            draft_manifest_payload=draft_manifest_payload,
            draft_updated_at=record.draft_updated_at,
            active_version_id=record.active_version_id,
        )
        self._save_record(updated)
        return updated

    def remove(self, template_id: str) -> TemplateRecord:
        record = self._remove_record(template_id)
        if record is None:
            raise TemplateNotFound(template_id)
        return record

    def remove_node(self, template_id: str, node_id: str) -> tuple[TemplateRecord, int]:
        record = self.get(template_id)
        manifest_payload, active_found, removed_edge_count = _remove_node_from_manifest(record.manifest_payload, node_id)
        draft_manifest_payload = None
        draft_found = False
        if record.draft_manifest_payload is not None:
            draft_manifest_payload, draft_found, _ = _remove_node_from_manifest(record.draft_manifest_payload, node_id)
        if not active_found and not draft_found:
            raise TemplateNodeNotFound(node_id)
        updated = TemplateRecord(
            template_id=record.template_id,
            manifest_payload=manifest_payload,
            draft_manifest_payload=draft_manifest_payload,
            draft_updated_at=record.draft_updated_at,
            active_version_id=record.active_version_id,
        )
        self._save_record(updated)
        return updated, removed_edge_count

    def list(self) -> list[TemplateRecord]:
        if self._store is not None:
            records = [self._record_from_dict(record) for record in self._store.list_records("templates")]
        else:
            records = list(self._templates.values())
        return sorted(records, key=lambda record: record.template_id)

    def get(self, template_id: str) -> TemplateRecord:
        record = self._get_record(template_id)
        if record is None:
            raise TemplateNotFound(template_id)
        return record

    def save_draft(self, template_id: str, draft_manifest_payload: dict[str, Any]) -> TemplateRecord:
        parse_manifest(draft_manifest_payload)
        record = self.get(template_id)
        updated = TemplateRecord(
            template_id=record.template_id,
            manifest_payload=deepcopy(record.manifest_payload),
            draft_manifest_payload=deepcopy(draft_manifest_payload),
            draft_updated_at=datetime.now(timezone.utc).isoformat(),
            active_version_id=record.active_version_id,
        )
        self._save_record(updated)
        return updated

    def get_draft(self, template_id: str) -> dict[str, Any] | None:
        record = self.get(template_id)
        return deepcopy(record.draft_manifest_payload) if record.draft_manifest_payload is not None else None

    def activate_version(self, template_id: str, version_id: str) -> TemplateRecord:
        record = self.get(template_id)
        updated = TemplateRecord(
            template_id=record.template_id,
            manifest_payload=deepcopy(record.manifest_payload),
            draft_manifest_payload=deepcopy(record.draft_manifest_payload) if record.draft_manifest_payload is not None else None,
            draft_updated_at=record.draft_updated_at,
            active_version_id=version_id,
        )
        self._save_record(updated)
        return updated

    def validate(
        self,
        template_id: str,
        extension_registry: ExtensionRegistry,
        tool_registry: ToolRegistry,
    ) -> TemplateValidationResult:
        try:
            manifest = parse_manifest(self.get(template_id).manifest_payload)
            issues = ManifestValidator(extension_registry, tool_registry).validate(manifest)
            return TemplateValidationResult(valid=True, issues=issues)
        except ManifestValidationError as exc:
            return TemplateValidationResult(valid=False, issues=[], error=exc)

    def compile(
        self,
        template_id: str,
        extension_registry: ExtensionRegistry,
        tool_registry: ToolRegistry,
        compiler: LangGraphManifestCompiler | None = None,
    ):
        validation = self.validate(template_id, extension_registry, tool_registry)
        if not validation.valid and validation.error is not None:
            raise validation.error
        manifest = parse_manifest(self.get(template_id).manifest_payload)
        return (compiler or LangGraphManifestCompiler()).compile(manifest)

    def run(
        self,
        template_id: str,
        graph_state: dict[str, object],
        runtime_context: RuntimeContext,
        extension_registry: ExtensionRegistry,
        tool_registry: ToolRegistry,
        compiler: LangGraphManifestCompiler | None = None,
    ) -> dict[str, object]:
        graph = self.compile(template_id, extension_registry, tool_registry, compiler)
        return graph.run(graph_state, runtime_context)

    def _save_record(self, record: TemplateRecord) -> None:
        if self._store is not None:
            self._store.save_record("templates", record.template_id, record.to_dict())
        else:
            self._templates[record.template_id] = record

    def _get_record(self, template_id: str) -> TemplateRecord | None:
        if self._store is not None:
            record = self._store.get_record("templates", template_id)
            return self._record_from_dict(record) if record is not None else None
        return self._templates.get(template_id)

    def _remove_record(self, template_id: str) -> TemplateRecord | None:
        if self._store is not None:
            record = self._store.remove_record("templates", template_id)
            return self._record_from_dict(record) if record is not None else None
        return self._templates.pop(template_id, None)

    @staticmethod
    def _record_from_dict(record: dict[str, Any]) -> TemplateRecord:
        return TemplateRecord(
            template_id=str(record["id"]),
            manifest_payload=deepcopy(record["manifest"]),
            draft_manifest_payload=deepcopy(record.get("draft_manifest")) if record.get("draft_manifest") is not None else None,
            draft_updated_at=str(record["draft_updated_at"]) if record.get("draft_updated_at") is not None else None,
            active_version_id=str(record["active_version_id"]) if record.get("active_version_id") is not None else None,
        )


def _remove_node_from_manifest(manifest_payload: dict[str, Any], node_id: str) -> tuple[dict[str, Any], bool, int]:
    payload = deepcopy(manifest_payload)
    graph = payload.get("runtime") if "runtime" in payload else payload.get("graph")
    if not isinstance(graph, dict):
        return payload, False, 0

    nodes = list(graph.get("nodes", []))
    found = any(isinstance(node, dict) and node.get("id") == node_id for node in nodes)
    if not found:
        return payload, False, 0

    graph["nodes"] = [node for node in nodes if not (isinstance(node, dict) and node.get("id") == node_id)]
    edges = list(graph.get("edges", []))
    filtered_edges = [edge for edge in edges if not _edge_references_node(edge, node_id)]
    graph["edges"] = filtered_edges
    ui_nodes = payload.get("ui", {}).get("nodes")
    if isinstance(ui_nodes, dict):
        ui_nodes.pop(node_id, None)
    return payload, True, len(edges) - len(filtered_edges)


def _edge_references_node(edge: object, node_id: str) -> bool:
    if not isinstance(edge, dict):
        return False
    source = edge.get("source", edge.get("from"))
    target = edge.get("target", edge.get("to"))
    return source == node_id or target == node_id
