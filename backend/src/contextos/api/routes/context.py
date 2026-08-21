from contextos.api.errors import ApiError
from contextos.context.group.service import ContextGroupOperationError, ContextGroupService
from contextos.context.projection import project_context_item, project_revision


def get_session_context(session_id: str, service: ContextGroupService) -> dict[str, object]:
    return {
        "status": 200,
        "body": [project_context_item(item) for item in service.list_items_by_session(session_id)],
    }


def post_context_group_pin(group_id: str, service: ContextGroupService) -> dict[str, object]:
    return _group_operation(lambda: service.pin_group(group_id, "user", "pin"))


def post_context_group_unpin(group_id: str, service: ContextGroupService) -> dict[str, object]:
    return _group_operation(lambda: service.unpin_group(group_id, "user", "unpin"))


def post_context_group_abstract(group_id: str, payload: dict[str, object], service: ContextGroupService) -> dict[str, object]:
    generated_content_by_item_id = payload["generated_content_by_item_id"]
    if not isinstance(generated_content_by_item_id, dict):
        return _error_response("context.invalid_payload", "generated_content_by_item_id must be an object")
    return _group_operation(lambda: service.abstract_group(group_id, generated_content_by_item_id, "system", "abstract"))


def post_context_group_evict(group_id: str, service: ContextGroupService) -> dict[str, object]:
    try:
        placeholder = service.evict_group(group_id, "system", "evict")
    except (ContextGroupOperationError, KeyError) as error:
        return _error_response("context.operation_failed", str(error))
    return {"status": 200, "body": {"ok": True, "placeholder": placeholder.__dict__}}


def post_context_item_evict(item_id: str, service: ContextGroupService) -> dict[str, object]:
    try:
        service.evict_item(item_id, "system", "evict")
    except ContextGroupOperationError as error:
        return _error_response(str(error), str(error))
    except KeyError as error:
        return _error_response("context.operation_failed", str(error))
    return {"status": 200, "body": {"ok": True}}


def post_context_group_restore(group_id: str, service: ContextGroupService) -> dict[str, object]:
    return _group_operation(lambda: service.restore_group(group_id, "user", "restore"))


def patch_context_item(item_id: str, payload: dict[str, object], service: ContextGroupService) -> dict[str, object]:
    service.edit_item(
        item_id,
        str(payload["user_override"]),
        str(payload.get("operator", "user")),
        str(payload.get("reason", "edit")),
    )
    return {
        "status": 200,
        "body": project_context_item(service.items[item_id]),
    }


def post_context_item_restore_system(item_id: str, service: ContextGroupService) -> dict[str, object]:
    service.restore_item_system_version(item_id, "user", "restore system version")
    return {
        "status": 200,
        "body": project_context_item(service.items[item_id]),
    }


def get_context_item_raw(item_id: str, service: ContextGroupService) -> dict[str, object]:
    return {
        "status": 200,
        "body": {"id": item_id, "raw_content": service.view_raw(item_id)},
    }


def get_context_item_revisions(item_id: str, service: ContextGroupService) -> dict[str, object]:
    return {
        "status": 200,
        "body": [project_revision(revision) for revision in service.list_revisions(item_id)],
    }


def _group_operation(operation) -> dict[str, object]:
    try:
        operation()
    except (ContextGroupOperationError, KeyError) as error:
        return _error_response("context.operation_failed", str(error))
    return {"status": 200, "body": {"ok": True}}


def _error_response(code: str, message: str) -> dict[str, object]:
    return {
        "status": 400,
        "body": ApiError(code=code, message=message, request_id="req-context", status=400).to_rest_payload(),
    }
