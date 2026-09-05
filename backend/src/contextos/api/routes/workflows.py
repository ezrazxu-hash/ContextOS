from __future__ import annotations

from contextos.workflow_v2.application.definitions import (
    RevisionConflictError,
    WorkflowV2DefinitionNotFound,
    WorkflowV2PublishedVersionNotFound,
    WorkflowV2PublishValidationError,
    WorkflowV2DefinitionService,
)
from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
from contextos.workflow_v2.domain.definitions import create_workflow_v2_definition
from contextos.tool.registry.registry import ToolRegistry


def post_workflow(payload: dict[str, object], workflow_service: WorkflowV2DefinitionService | None = None) -> dict[str, object]:
    if workflow_service is None:
        return {"status": 201, "body": create_workflow_v2_definition(payload)}
    return {"status": 201, "body": workflow_service.create(payload)}


def get_workflow(workflow_id: str, workflow_service: WorkflowV2DefinitionService) -> dict[str, object]:
    try:
        return {"status": 200, "body": workflow_service.get(workflow_id)}
    except WorkflowV2DefinitionNotFound:
        return _not_found(workflow_id)


def put_workflow_draft(workflow_id: str, payload: dict[str, object], workflow_service: WorkflowV2DefinitionService) -> dict[str, object]:
    try:
        expected_revision = int(payload.get("expectedRevision", payload.get("revision", 0)))
        return {"status": 200, "body": workflow_service.save_draft(workflow_id, payload, expected_revision=expected_revision)}
    except WorkflowV2DefinitionNotFound:
        return _not_found(workflow_id)
    except RevisionConflictError:
        return {
            "status": 409,
            "body": {
                "error": {
                    "code": "workflow.revision_conflict",
                    "message": f"Workflow draft revision conflict: {workflow_id}",
                    "status": 409,
                }
            },
        }


def post_workflow_validate(
    workflow_id: str,
    payload: dict[str, object],
    workflow_service: WorkflowV2DefinitionService,
    tool_registry: ToolRegistry | None = None,
) -> dict[str, object]:
    try:
        definition = payload or workflow_service.get(workflow_id)
    except WorkflowV2DefinitionNotFound:
        return _not_found(workflow_id)
    return {"status": 200, "body": WorkflowV2DefinitionValidator(tool_registry=tool_registry).validate(definition)}


def post_workflow_publish(
    workflow_id: str,
    workflow_service: WorkflowV2DefinitionService,
    tool_registry: ToolRegistry | None = None,
) -> dict[str, object]:
    try:
        published = workflow_service.publish(
            workflow_id,
            validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry),
        )
        return {"status": 201, "body": published}
    except WorkflowV2DefinitionNotFound:
        return _not_found(workflow_id)
    except WorkflowV2PublishValidationError as error:
        return {
            "status": 422,
            "body": {
                "error": {
                    "code": "workflow.validation_failed",
                    "message": f"Workflow draft validation failed: {workflow_id}",
                    "status": 422,
                },
                "validation": error.validation,
            },
        }


def get_workflow_versions(workflow_id: str, workflow_service: WorkflowV2DefinitionService) -> dict[str, object]:
    try:
        return {"status": 200, "body": {"versions": workflow_service.list_versions(workflow_id)}}
    except WorkflowV2DefinitionNotFound:
        return _not_found(workflow_id)


def get_workflow_version(workflow_id: str, version: int, workflow_service: WorkflowV2DefinitionService) -> dict[str, object]:
    try:
        return {"status": 200, "body": workflow_service.get_version(workflow_id, version)}
    except WorkflowV2DefinitionNotFound:
        return _not_found(workflow_id)
    except WorkflowV2PublishedVersionNotFound:
        return {
            "status": 404,
            "body": {
                "error": {
                    "code": "workflow.version_not_found",
                    "message": f"Workflow version not found: {workflow_id}@{version}",
                    "status": 404,
                }
            },
        }


def _not_found(workflow_id: str) -> dict[str, object]:
    return {
        "status": 404,
        "body": {
            "error": {
                "code": "workflow.not_found",
                "message": f"Workflow not found: {workflow_id}",
                "status": 404,
            }
        },
    }
