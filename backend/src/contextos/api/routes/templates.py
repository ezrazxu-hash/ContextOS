from typing import Callable

from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.service import TemplateNotFound, TemplateService
from contextos.template.validator.validator import ManifestValidationError
from contextos.tool.registry.registry import ToolRegistry


def post_template(payload: dict[str, object], template_service: TemplateService) -> dict[str, object]:
    record = template_service.save(payload)
    return {"status": 201, "body": record.to_dict()}


def list_templates(template_service: TemplateService) -> dict[str, object]:
    return {"status": 200, "body": {"templates": [_template_summary(record) for record in template_service.list()]}}


def get_template(template_id: str, template_service: TemplateService) -> dict[str, object]:
    try:
        return {"status": 200, "body": template_service.get(template_id).to_dict()}
    except TemplateNotFound:
        return _not_found(template_id)


def put_template(template_id: str, payload: dict[str, object], template_service: TemplateService) -> dict[str, object]:
    record = template_service.update(template_id, payload)
    return {"status": 200, "body": record.to_dict()}


def post_template_validate(
    template_id: str,
    template_service: TemplateService,
    *,
    extension_registry: ExtensionRegistry,
    tool_registry: ToolRegistry,
    execution_probe: Callable[[], object] | None = None,
) -> dict[str, object]:
    del execution_probe
    result = template_service.validate(template_id, extension_registry, tool_registry)
    if result.valid:
        return {"status": 200, "body": {"valid": True, "issues": []}}
    return {"status": 400, "body": _validation_error(result.error)}


def post_template_compile(
    template_id: str,
    template_service: TemplateService,
    *,
    extension_registry: ExtensionRegistry,
    tool_registry: ToolRegistry,
) -> dict[str, object]:
    try:
        template_service.compile(template_id, extension_registry, tool_registry)
        return {"status": 200, "body": {"compiled": True}}
    except ManifestValidationError as exc:
        return {"status": 400, "body": _validation_error(exc)}


def post_template_run(
    template_id: str,
    payload: dict[str, object],
    template_service: TemplateService,
    *,
    extension_registry: ExtensionRegistry,
    tool_registry: ToolRegistry,
    provider_call: Callable[[], object] | None = None,
) -> dict[str, object]:
    del provider_call
    runtime_context = RuntimeContext(
        session_id=str(payload["session_id"]),
        timeline_id=str(payload["timeline_id"]),
        trace_id=str(payload["trace_id"]),
    )
    graph_state = template_service.run(
        template_id,
        graph_state=dict(payload.get("graph_state", {})),
        runtime_context=runtime_context,
        extension_registry=extension_registry,
        tool_registry=tool_registry,
    )
    return {"status": 200, "body": {"graph_state": graph_state}}


def _validation_error(error: ManifestValidationError | None) -> dict[str, object]:
    return {
        "error": {
            "code": error.code if error is not None else "manifest.invalid",
            "field_path": error.field_path if error is not None else "",
            "message": str(error) if error is not None else "Manifest is invalid",
        }
    }


def _not_found(template_id: str) -> dict[str, object]:
    return {
        "status": 404,
        "body": {
            "error": {
                "code": "template.not_found",
                "message": f"Template not found: {template_id}",
                "status": 404,
            }
        },
    }


def _template_summary(record) -> dict[str, object]:
    template = record.manifest_payload["template"]
    return {
        "id": record.template_id,
        "name": template["name"],
        "version": template["version"],
    }
