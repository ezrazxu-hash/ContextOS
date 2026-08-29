from contextos.api.errors import ApiError
from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
from contextos.runtime.conversation.service import ConversationGroupService
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.session.service import SessionNotFound, SessionService
from contextos.runtime.timeline.repository import InMemoryTimelineRepository
from uuid import uuid4


def post_session(payload: dict[str, object], service: SessionService, request_id: str = "req-session-create") -> dict[str, object]:
    workspace_id = payload.get("workspace_id")
    metadata = payload.get("metadata")
    session = service.create_session(
        agent_template_id=str(payload["agent_template_id"]),
        workspace_id=str(workspace_id) if workspace_id is not None else None,
        title=str(payload["title"]) if payload.get("title") is not None else None,
        metadata=dict(metadata) if isinstance(metadata, dict) else None,
    )
    return {
        "status": 201,
        "body": session.to_dict(),
    }


def list_sessions(service: SessionService) -> dict[str, object]:
    return {
        "status": 200,
        "body": {
            "sessions": [session.to_dict() for session in service.list_sessions()],
        },
    }


def get_session(session_id: str, service: SessionService, request_id: str = "req-session-get") -> dict[str, object]:
    try:
        session = service.get_session(session_id)
    except SessionNotFound:
        return {
            "status": 404,
            "body": ApiError(
                code="session.not_found",
                message="Session not found",
                request_id=request_id,
                status=404,
            ).to_rest_payload(),
        }
    return {
        "status": 200,
        "body": session.to_dict(),
    }


def patch_session(session_id: str, payload: dict[str, object], service: SessionService, request_id: str = "req-session-patch") -> dict[str, object]:
    try:
        metadata = payload.get("metadata")
        session = service.update_session_metadata(
            session_id,
            title=str(payload["title"]) if payload.get("title") is not None else None,
            metadata=dict(metadata) if isinstance(metadata, dict) else None,
        )
    except SessionNotFound:
        return {
            "status": 404,
            "body": ApiError(
                code="session.not_found",
                message="Session not found",
                request_id=request_id,
                status=404,
            ).to_rest_payload(),
        }
    return {
        "status": 200,
        "body": session.to_dict(),
    }


def remove_session(
    session_id: str,
    service: SessionService,
    timeline_repository: InMemoryTimelineRepository,
    message_service: MessageService,
    conversation_group_repository: InMemoryConversationGroupRepository,
    checkpoint_store: InMemoryCheckpointStore,
    request_id: str = "req-session-delete",
) -> dict[str, object]:
    try:
        session = service.remove_session(session_id)
    except SessionNotFound:
        return {
            "status": 404,
            "body": ApiError(
                code="session.not_found",
                message="Session not found",
                request_id=request_id,
                status=404,
            ).to_rest_payload(),
        }

    timeline_repository.remove_by_session(session_id)
    message_service.remove_session_messages(session_id)
    conversation_group_repository.remove_by_session(session_id)
    checkpoint_store.remove_by_session(session_id)
    return {
        "status": 200,
        "body": session.to_dict(),
    }


def post_session_message(
    session_id: str,
    payload: dict[str, object],
    service: MessageService,
    *,
    conversation_group_service: ConversationGroupService | None = None,
    default_timeline_id: str | None = None,
) -> dict[str, object]:
    role = payload.get("role")
    content = payload.get("content")
    if role is None or content is None:
        return {
            "status": 400,
            "body": ApiError(
                code="message.invalid",
                message="Message role and content are required",
                request_id="req-message-create",
                status=400,
            ).to_rest_payload(),
        }
    timeline_id = _optional_str(payload.get("timeline_id") or payload.get("timelineId") or default_timeline_id)
    group_id = _optional_str(payload.get("group_id") or payload.get("groupId"))
    message_id = _optional_str(payload.get("id") or payload.get("message_id") or payload.get("messageId"))
    context_group_ids = list(payload.get("context_group_ids", []))

    if role == "user" and conversation_group_service is not None and timeline_id is not None:
        message_id = message_id or f"message_{uuid4().hex}"
        group = conversation_group_service.start_turn(session_id, timeline_id, message_id, group_id=group_id)
        group_id = group.id
        context_group_ids = [group.id]

    message = service.create_message(
        session_id=session_id,
        role=str(role),
        content=str(content),
        status=str(payload.get("status", "completed")),
        token_count=int(payload.get("token_count", 0)),
        timeline_id=timeline_id,
        group_id=group_id,
        context_group_ids=context_group_ids,
        checkpoint_id=_optional_str(payload.get("checkpoint_id")),
        trace_id=_optional_str(payload.get("trace_id")),
        tool_call_ids=list(payload.get("tool_call_ids", [])),
        tool_result_ids=list(payload.get("tool_result_ids", [])),
        message_id=message_id,
    )
    return {
        "status": 201,
        "body": message.to_dict(),
    }


def get_session_messages(
    session_id: str,
    service: MessageService,
    after_cursor: int | None = None,
    limit: int = 50,
    timeline_id: str | None = None,
) -> dict[str, object]:
    messages, next_cursor = service.list_messages(session_id, after_cursor=after_cursor, limit=limit, timeline_id=timeline_id)
    return {
        "status": 200,
        "body": {
            "messages": [message.to_dict() for message in messages],
            "next_cursor": next_cursor,
        },
    }


def _optional_str(value: object) -> str | None:
    return str(value) if value is not None else None
