from typing import Callable

from contextos.api.contracts.message_edit import ImpactSummary, parse_message_edit_request
from contextos.api.errors import ApiError
from contextos.provider.base.ir import ToolResult
from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.session.message_service import MessageNotFound, MessageService
from contextos.tool.risk.impact_analyzer import EditImpactAnalyzer


IMPACT_CHECKS = [
    "message_tool_result_semantic_conflict",
    "tool_call_parameter_impact",
    "state_dependency",
    "graph_dependency",
    "side_effect",
]


def patch_message(
    message_id: str,
    payload: dict[str, object],
    message_service: MessageService,
    revision_service: MessageRevisionService,
    tool_runner: Callable[[str], object] | None = None,
) -> dict[str, object]:
    del tool_runner
    try:
        message = message_service.get_message(message_id)
    except MessageNotFound:
        return _not_found(message_id)

    request = parse_message_edit_request(payload)
    revision = revision_service.append_revision(
        message,
        new_content=request.new_content,
        operator=request.operator,
        reason=request.reason,
    )
    message = message_service.update_message_content(message_id, request.new_content, revision.id)
    issues = EditImpactAnalyzer().analyze_message_tool_result_conflicts(
        request.new_content,
        [
            ToolResult(call_id=str(item["call_id"]), content=item.get("content"))
            for item in payload.get("tool_results", [])
            if isinstance(item, dict)
        ],
    )
    impact = ImpactSummary(
        message_id=message_id,
        revision_id=revision.id,
        triggered=True,
        requires_replay=False,
        checks=IMPACT_CHECKS,
        issues=[issue.to_dict() for issue in issues],
    )
    return {
        "status": 200,
        "body": {
            "revision_id": revision.id,
            "message": message.to_dict(),
            "impact": impact.to_dict(),
        },
    }


def soft_delete_message(message_id: str, message_service: MessageService) -> dict[str, object]:
    try:
        deleted = message_service.soft_delete_message(message_id)
    except MessageNotFound:
        return _not_found(message_id)

    return {
        "status": 200,
        "body": {
            "message_ids": [message.id for message in deleted],
            "message": deleted[0].to_dict() if deleted else None,
        },
    }


def get_message_original(message_id: str, revision_service: MessageRevisionService) -> dict[str, object]:
    revisions = revision_service.list_revisions(message_id)
    if not revisions:
        return _not_found(message_id)
    return {
        "status": 200,
        "body": {
            "message_id": message_id,
            "original_content": revisions[0].original_content,
        },
    }


def get_message_impact(message_id: str, revision_service: MessageRevisionService) -> dict[str, object]:
    revisions = revision_service.list_revisions(message_id)
    if not revisions:
        return _not_found(message_id)
    revision = revisions[-1]
    return {
        "status": 200,
        "body": ImpactSummary(
            message_id=message_id,
            revision_id=revision.id,
            triggered=True,
            requires_replay=False,
            checks=IMPACT_CHECKS,
        ).to_dict(),
    }


def _not_found(message_id: str) -> dict[str, object]:
    return {
        "status": 404,
        "body": ApiError(
            code="message.not_found",
            message=f"Message not found: {message_id}",
            request_id="req-message",
            status=404,
        ).to_rest_payload(),
    }
