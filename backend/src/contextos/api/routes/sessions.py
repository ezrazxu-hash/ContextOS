from contextos.api.errors import ApiError
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.session.service import SessionNotFound, SessionService


def post_session(payload: dict[str, object], service: SessionService, request_id: str = "req-session-create") -> dict[str, object]:
    workspace_id = payload.get("workspace_id")
    session = service.create_session(
        agent_template_id=str(payload["agent_template_id"]),
        workspace_id=str(workspace_id) if workspace_id is not None else None,
    )
    return {
        "status": 201,
        "body": session.to_dict(),
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


def post_session_message(session_id: str, payload: dict[str, object], service: MessageService) -> dict[str, object]:
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
    message = service.create_message(
        session_id=session_id,
        role=str(role),
        content=str(content),
        status=str(payload.get("status", "completed")),
        token_count=int(payload.get("token_count", 0)),
        context_group_ids=list(payload.get("context_group_ids", [])),
        checkpoint_id=_optional_str(payload.get("checkpoint_id")),
        trace_id=_optional_str(payload.get("trace_id")),
        tool_call_ids=list(payload.get("tool_call_ids", [])),
        tool_result_ids=list(payload.get("tool_result_ids", [])),
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
) -> dict[str, object]:
    messages, next_cursor = service.list_messages(session_id, after_cursor=after_cursor, limit=limit)
    return {
        "status": 200,
        "body": {
            "messages": [message.to_dict() for message in messages],
            "next_cursor": next_cursor,
        },
    }


def _optional_str(value: object) -> str | None:
    return str(value) if value is not None else None
