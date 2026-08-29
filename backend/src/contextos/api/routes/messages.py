from typing import Callable

from contextos.api.contracts.message_edit import ImpactSummary, parse_message_edit_request
from contextos.api.errors import ApiError
from contextos.provider.base.ir import ToolResult
from contextos.runtime.conversation.model import ConversationGroupState
from contextos.runtime.conversation.service import ConversationGroupNotFound, ConversationGroupService
from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.session.message_service import MessageNotFound, MessageService
from contextos.runtime.timeline.edit_fork_service import fork_timeline_context
from contextos.runtime.timeline.service import TimelineService
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
    *,
    timeline_service: TimelineService | None = None,
    conversation_group_service: ConversationGroupService | None = None,
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
    semantic_edit = bool(payload.get("semantic", False))
    if semantic_edit and timeline_service is not None and conversation_group_service is not None and message.timeline_id is not None:
        timeline = timeline_service.fork_timeline(
            parent_timeline_id=message.timeline_id,
            fork_checkpoint_id=message.checkpoint_id or "",
            fork_message_id=message.id,
        )
        timeline_service.activate_timeline(timeline.id)
        working_context_messages = fork_timeline_context(
            parent_timeline_id=message.timeline_id,
            child_timeline_id=timeline.id,
            edited_message=message,
            edited_content=request.new_content,
            message_service=message_service,
            conversation_group_service=conversation_group_service,
            include_edited_message=True,
            revision_id=revision.id,
        )
        child_message = _message_with_revision(message.session_id, timeline.id, revision.id, message_service)
        impact = _impact_summary(message_id, revision.id, request.new_content, payload)
        return {
            "status": 200,
            "body": {
                "revision_id": revision.id,
                "message": (child_message or message).to_dict(),
                "timeline": timeline.to_dict(),
                "working_context_messages": working_context_messages,
                "impact": impact.to_dict(),
            },
        }

    message = message_service.update_message_content(message_id, request.new_content, revision.id)
    impact = _impact_summary(message_id, revision.id, request.new_content, payload)
    return {
        "status": 200,
        "body": {
            "revision_id": revision.id,
            "message": message.to_dict(),
            "impact": impact.to_dict(),
        },
    }


def _impact_summary(message_id: str, revision_id: str, content: str, payload: dict[str, object]) -> ImpactSummary:
    issues = EditImpactAnalyzer().analyze_message_tool_result_conflicts(
        content,
        [
            ToolResult(call_id=str(item["call_id"]), content=item.get("content"))
            for item in payload.get("tool_results", [])
            if isinstance(item, dict)
        ],
    )
    return ImpactSummary(
        message_id=message_id,
        revision_id=revision_id,
        triggered=True,
        requires_replay=False,
        checks=IMPACT_CHECKS,
        issues=[issue.to_dict() for issue in issues],
    )


def _message_with_revision(session_id: str, timeline_id: str, revision_id: str, message_service: MessageService):
    messages, _ = message_service.list_messages(session_id, limit=10000, timeline_id=timeline_id)
    for message in reversed(messages):
        if message.revision_id == revision_id:
            return message
    return None


def soft_delete_message(
    message_id: str,
    message_service: MessageService,
    conversation_group_service: ConversationGroupService | None = None,
    *,
    timeline_service: TimelineService | None = None,
    semantic_delete: bool = False,
) -> dict[str, object]:
    if semantic_delete and timeline_service is not None and conversation_group_service is not None:
        try:
            target = message_service.get_message(message_id)
        except MessageNotFound:
            return _not_found(message_id)
        if target.timeline_id is not None:
            timeline = timeline_service.fork_timeline(
                parent_timeline_id=target.timeline_id,
                fork_checkpoint_id=target.checkpoint_id or "",
                fork_message_id=target.id,
            )
            timeline_service.activate_timeline(timeline.id)
            working_context_messages = fork_timeline_context(
                parent_timeline_id=target.timeline_id,
                child_timeline_id=timeline.id,
                edited_message=target,
                edited_content=None,
                message_service=message_service,
                conversation_group_service=conversation_group_service,
                include_edited_message=False,
            )
            return {
                "status": 200,
                "body": {
                    "message_ids": _semantic_delete_message_ids(target, message_service),
                    "message": target.to_dict(),
                    "timeline": timeline.to_dict(),
                    "working_context_messages": working_context_messages,
                },
            }

    try:
        deleted = message_service.soft_delete_message(message_id)
    except MessageNotFound:
        return _not_found(message_id)

    if conversation_group_service is not None:
        for group_id in {message.group_id for message in deleted if message.group_id}:
            try:
                conversation_group_service.set_state(group_id, ConversationGroupState.DELETED)
            except ConversationGroupNotFound:
                continue

    return {
        "status": 200,
        "body": {
            "message_ids": [message.id for message in deleted],
            "message": deleted[0].to_dict() if deleted else None,
        },
    }


def _semantic_delete_message_ids(target, message_service: MessageService) -> list[str]:
    related_group_ids = {target.group_id, *target.context_group_ids} - {None}
    messages, _ = message_service.list_messages(target.session_id, limit=10000, timeline_id=target.timeline_id)
    if not related_group_ids:
        return [target.id]
    return [
        message.id
        for message in messages
        if message.group_id in related_group_ids or related_group_ids.intersection(message.context_group_ids)
    ]


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
