from __future__ import annotations

from contextos.template.compiler.dry_run import CompileDryRunError, CompileDryRunService
from contextos.template.manifest.parser import parse_manifest
from contextos.template.service import TemplateService
from contextos.template.validator.validator import ManifestValidator, ValidationResult
from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.version.model import AgentVersion
from contextos.template.version.service import AgentVersionService
from contextos.tool.registry.registry import ToolRegistry


class PublishValidationError(Exception):
    def __init__(self, validation: ValidationResult) -> None:
        super().__init__("Agent draft is invalid")
        self.validation = validation


class PublishCompileError(Exception):
    def __init__(self, code: str, field_path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field_path = field_path


class PublishService:
    def __init__(
        self,
        template_service: TemplateService,
        version_service: AgentVersionService,
        extension_registry: ExtensionRegistry,
        tool_registry: ToolRegistry,
        *,
        dry_run_service: CompileDryRunService | None = None,
    ) -> None:
        self._template_service = template_service
        self._version_service = version_service
        self._extension_registry = extension_registry
        self._tool_registry = tool_registry
        self._dry_run_service = dry_run_service or CompileDryRunService()

    def publish(self, agent_id: str) -> AgentVersion:
        draft = self._template_service.get_draft(agent_id)
        if draft is None:
            validation = ValidationResult(valid=False, errors=[], warnings=[])
            raise PublishValidationError(validation)

        manifest = parse_manifest(draft)
        validation = ManifestValidator(self._extension_registry, self._tool_registry).validate_result(manifest)
        if not validation.valid:
            raise PublishValidationError(validation)

        try:
            self._dry_run_service.run(manifest)
        except CompileDryRunError as exc:
            raise PublishCompileError(exc.code, exc.field_path, str(exc)) from exc

        version = self._version_service.create_published_version(agent_id, draft)
        self._template_service.activate_version(agent_id, version.id)
        return version
