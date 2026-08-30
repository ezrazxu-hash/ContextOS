from contextos.template.compiler.dry_run import CompileDryRunError, CompileDryRunService
from contextos.template.manifest.parser import ManifestParseError, parse_manifest
from contextos.template.publish_service import PublishCompileError, PublishService, PublishValidationError
from contextos.template.service import TemplateNotFound, TemplateService
from contextos.template.validator.validator import ManifestValidator, ValidationIssue, ValidationResult
from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.version.service import AgentVersionNotFound, AgentVersionService
from contextos.tool.registry.registry import ToolRegistry


def list_agents(template_service: TemplateService, version_service: AgentVersionService) -> dict[str, object]:
    agents: list[dict[str, object]] = []
    for record in template_service.list():
        if record.active_version_id is None:
            continue
        try:
            version = version_service.get_version(record.active_version_id)
        except AgentVersionNotFound:
            continue
        version_payload = version.to_dict()
        if version_payload.get("status") != "published":
            continue
        template = record.manifest_payload.get("template", {})
        agents.append(
            {
                "id": record.template_id,
                "name": str(template.get("name") or record.template_id),
                "active_version": version_payload,
            }
        )
    return {"status": 200, "body": {"agents": agents}}


def get_agent_draft(agent_id: str, template_service: TemplateService) -> dict[str, object]:
    try:
        record = template_service.get(agent_id)
    except TemplateNotFound:
        return _not_found(agent_id)
    return {
        "status": 200,
        "body": {
            "id": agent_id,
            "draft_manifest": template_service.get_draft(agent_id),
            "draft_updated_at": record.draft_updated_at,
        },
    }


def put_agent_draft(agent_id: str, payload: dict[str, object], template_service: TemplateService) -> dict[str, object]:
    try:
        record = template_service.save_draft(agent_id, payload)
    except TemplateNotFound:
        return _not_found(agent_id)
    return {
        "status": 200,
        "body": {
            "id": agent_id,
            "draft_manifest": record.draft_manifest_payload,
            "draft_updated_at": record.draft_updated_at,
        },
    }


def post_agent_validate(
    agent_id: str,
    payload: dict[str, object],
    template_service: TemplateService,
    *,
    extension_registry: ExtensionRegistry,
    tool_registry: ToolRegistry,
) -> dict[str, object]:
    try:
        manifest_payload = payload or template_service.get_draft(agent_id)
        if manifest_payload is None:
            return {"status": 404, "body": _draft_not_found(agent_id)}
        manifest = parse_manifest(manifest_payload)
    except TemplateNotFound:
        return _not_found(agent_id)
    except ManifestParseError as exc:
        result = ValidationResult(
            valid=False,
            errors=[ValidationIssue("manifest.parse_error", str(exc), exc.field_path)],
            warnings=[],
        )
        return {"status": 200, "body": result.to_dict()}

    result = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)
    return {"status": 200, "body": result.to_dict()}


def post_agent_graph_preview(
    agent_id: str,
    payload: dict[str, object],
    *,
    extension_registry: ExtensionRegistry,
    tool_registry: ToolRegistry,
) -> dict[str, object]:
    del agent_id
    try:
        manifest = parse_manifest(payload)
        validation = ManifestValidator(extension_registry, tool_registry).validate_result(manifest)
        if not validation.valid:
            first = validation.errors[0]
            return {
                "status": 200,
                "body": {
                    "valid": False,
                    "error": {
                        "code": first.code,
                        "field_path": first.field,
                        "message": first.message,
                    },
                },
            }
        result = CompileDryRunService().run(manifest)
    except ManifestParseError as exc:
        return {
            "status": 200,
            "body": {
                "valid": False,
                "error": {
                    "code": "manifest.parse_error",
                    "field_path": exc.field_path,
                    "message": str(exc),
                },
            },
        }
    except CompileDryRunError as exc:
        return {
            "status": 200,
            "body": {
                "valid": False,
                "error": {
                    "code": exc.code,
                    "field_path": exc.field_path,
                    "message": str(exc),
                },
            },
        }

    return {
        "status": 200,
        "body": {
            "valid": True,
            "start": "START",
            "end": "END",
            "nodes": [node.to_runtime_dict() for node in manifest.graph.nodes],
            "edges": [_edge_preview(edge) for edge in manifest.graph.edges],
            "execution_order": list(result.graph_state.get("visited_nodes", [])),
            "graph_state": result.graph_state,
        },
    }


def post_agent_publish(agent_id: str, publish_service: PublishService) -> dict[str, object]:
    try:
        version = publish_service.publish(agent_id)
    except PublishValidationError as exc:
        return {"status": 400, "body": exc.validation.to_dict()}
    except PublishCompileError as exc:
        return {
            "status": 400,
            "body": {
                "error": {
                    "code": exc.code,
                    "field_path": exc.field_path,
                    "message": str(exc),
                    "status": 400,
                }
            },
        }
    return {"status": 200, "body": version.to_dict()}


def _edge_preview(edge) -> dict[str, object]:
    payload = {"source": edge.source, "target": edge.target}
    route = edge.route if edge.route is not None else edge.condition
    if route is not None:
        payload["route"] = route
    return payload


def get_agent_versions(agent_id: str, version_service: AgentVersionService) -> dict[str, object]:
    return {"status": 200, "body": {"versions": [version.to_dict() for version in version_service.list_versions(agent_id)]}}


def get_agent_version(version_id: str, version_service: AgentVersionService) -> dict[str, object]:
    try:
        version = version_service.get_version(version_id)
    except AgentVersionNotFound:
        return {
            "status": 404,
            "body": {
                "error": {
                    "code": "agent_version.not_found",
                    "message": f"AgentVersion not found: {version_id}",
                    "status": 404,
                }
            },
        }
    return {"status": 200, "body": version.to_dict()}


def _not_found(agent_id: str) -> dict[str, object]:
    return {
        "status": 404,
        "body": {
            "error": {
                "code": "agent.not_found",
                "message": f"Agent not found: {agent_id}",
                "status": 404,
            }
        },
    }


def _draft_not_found(agent_id: str) -> dict[str, object]:
    return {
        "error": {
            "code": "agent.draft_not_found",
            "message": f"Agent draft not found: {agent_id}",
            "status": 404,
        }
    }
