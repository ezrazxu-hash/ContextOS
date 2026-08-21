from contextos.api.errors import ApiError
from contextos.runtime.debug.projection import DebugProjection, DebugSessionNotFound


def get_debug_index(
    session_id: str,
    projection: DebugProjection,
    *,
    trace_id: str | None = None,
    checkpoint_id: str | None = None,
    message_id: str | None = None,
    message_after_cursor: int | None = None,
    message_limit: int = 50,
    offset: int = 0,
    limit: int = 50,
    request_id: str = "req-debug-index",
) -> dict[str, object]:
    try:
        body = projection.index(
            session_id,
            trace_id=trace_id,
            checkpoint_id=checkpoint_id,
            message_id=message_id,
            message_after_cursor=message_after_cursor,
            message_limit=message_limit,
            offset=offset,
            limit=limit,
        )
    except DebugSessionNotFound:
        return {
            "status": 404,
            "body": ApiError("session.not_found", "Session not found", request_id, 404).to_rest_payload(),
        }
    return {"status": 200, "body": body}
