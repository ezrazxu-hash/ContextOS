from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.manifest.parser import parse_manifest
from contextos.template.validator.validator import ManifestValidationError, ManifestValidator
from contextos.tool.registry.registry import ToolRegistry


class TemplateNotFound(Exception):
    pass


@dataclass(frozen=True)
class TemplateRecord:
    template_id: str
    manifest_payload: dict[str, Any]

    def to_dict(self) -> dict[str, object]:
        return {"id": self.template_id, "manifest": deepcopy(self.manifest_payload)}


@dataclass(frozen=True)
class TemplateValidationResult:
    valid: bool
    issues: list[object]
    error: ManifestValidationError | None = None


class TemplateService:
    def __init__(self) -> None:
        self._templates: dict[str, TemplateRecord] = {}

    def save(self, manifest_payload: dict[str, Any]) -> TemplateRecord:
        manifest = parse_manifest(manifest_payload)
        record = TemplateRecord(template_id=manifest.template.id, manifest_payload=deepcopy(manifest_payload))
        self._templates[record.template_id] = record
        return record

    def update(self, template_id: str, manifest_payload: dict[str, Any]) -> TemplateRecord:
        manifest = parse_manifest(manifest_payload)
        record = TemplateRecord(template_id=template_id, manifest_payload=deepcopy(manifest_payload))
        self._templates[manifest.template.id] = record
        if manifest.template.id != template_id and template_id in self._templates:
            del self._templates[template_id]
        return record

    def get(self, template_id: str) -> TemplateRecord:
        if template_id not in self._templates:
            raise TemplateNotFound(template_id)
        return self._templates[template_id]

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
