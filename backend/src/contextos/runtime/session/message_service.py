from uuid import uuid4

from contextos.runtime.session.message import MessageRole, MessageStatus, SessionMessage


class MessageNotFound(Exception):
    pass


class MessageService:
    def __init__(self) -> None:
        self._messages_by_session: dict[str, list[SessionMessage]] = {}
        self._next_cursor_by_session: dict[str, int] = {}

    def create_message(
        self,
        session_id: str,
        role: str,
        content: str,
        status: str = "completed",
        token_count: int = 0,
        context_group_ids: list[str] | None = None,
        checkpoint_id: str | None = None,
        trace_id: str | None = None,
        tool_call_ids: list[str] | None = None,
        tool_result_ids: list[str] | None = None,
    ) -> SessionMessage:
        cursor = self._next_cursor_by_session.get(session_id, 1)
        self._next_cursor_by_session[session_id] = cursor + 1
        message = SessionMessage(
            id=f"message_{uuid4().hex}",
            session_id=session_id,
            cursor=cursor,
            role=MessageRole(role),
            content=content,
            status=MessageStatus(status),
            token_count=token_count,
            context_group_ids=context_group_ids or [],
            checkpoint_id=checkpoint_id,
            trace_id=trace_id,
            tool_call_ids=tool_call_ids or [],
            tool_result_ids=tool_result_ids or [],
        )
        self._messages_by_session.setdefault(session_id, []).append(message)
        return message

    def list_messages(
        self,
        session_id: str,
        after_cursor: int | None = None,
        limit: int = 50,
    ) -> tuple[list[SessionMessage], int | None]:
        messages = [
            message
            for message in self._messages_by_session.get(session_id, [])
            if after_cursor is None or message.cursor > after_cursor
        ]
        page = messages[:limit]
        next_cursor = page[-1].cursor if len(messages) > limit and page else None
        return page, next_cursor

    def get_message(self, message_id: str) -> SessionMessage:
        for messages in self._messages_by_session.values():
            for message in messages:
                if message.id == message_id:
                    return message
        raise MessageNotFound(message_id)
