from uuid import uuid4

from contextos.runtime.session.message import MessageRole, MessageStatus, SessionMessage
from contextos.runtime.persistence.json_store import JsonRuntimeStore


class MessageNotFound(Exception):
    pass


class InMemoryMessageRepository:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._messages_by_session: dict[str, list[SessionMessage]] = {}

    def save(self, message: SessionMessage) -> SessionMessage:
        if self._store is not None:
            self._store.save_record("messages", message.id, message.to_dict())
        else:
            messages = self._messages_by_session.setdefault(message.session_id, [])
            existing_index = next((index for index, item in enumerate(messages) if item.id == message.id), None)
            if existing_index is None:
                messages.append(message)
            else:
                messages[existing_index] = message
        return message

    def list_by_session(self, session_id: str) -> list[SessionMessage]:
        if self._store is not None:
            return sorted(
                [_message_from_dict(record) for record in self._store.list_records("messages") if record.get("session_id") == session_id],
                key=lambda message: message.cursor,
            )
        return sorted(self._messages_by_session.get(session_id, []), key=lambda message: message.cursor)

    def get(self, message_id: str) -> SessionMessage | None:
        if self._store is not None:
            record = self._store.get_record("messages", message_id)
            return _message_from_dict(record) if record is not None else None
        for messages in self._messages_by_session.values():
            for message in messages:
                if message.id == message_id:
                    return message
        return None

    def next_cursor(self, session_id: str) -> int:
        messages = self.list_by_session(session_id)
        return (messages[-1].cursor + 1) if messages else 1


class MessageService:
    def __init__(self, repository: InMemoryMessageRepository | None = None) -> None:
        self._repository = repository or InMemoryMessageRepository()

    def create_message(
        self,
        session_id: str,
        role: str,
        content: str,
        status: str = "completed",
        token_count: int = 0,
        timeline_id: str | None = None,
        group_id: str | None = None,
        context_group_ids: list[str] | None = None,
        checkpoint_id: str | None = None,
        trace_id: str | None = None,
        tool_call_ids: list[str] | None = None,
        tool_result_ids: list[str] | None = None,
        message_id: str | None = None,
    ) -> SessionMessage:
        cursor = self._repository.next_cursor(session_id)
        message = SessionMessage(
            id=message_id or f"message_{uuid4().hex}",
            session_id=session_id,
            cursor=cursor,
            role=MessageRole(role),
            content=content,
            status=MessageStatus(status),
            token_count=token_count,
            timeline_id=timeline_id,
            group_id=group_id,
            context_group_ids=context_group_ids or [],
            checkpoint_id=checkpoint_id,
            trace_id=trace_id,
            tool_call_ids=tool_call_ids or [],
            tool_result_ids=tool_result_ids or [],
        )
        return self._repository.save(message)

    def list_messages(
        self,
        session_id: str,
        after_cursor: int | None = None,
        limit: int = 50,
        timeline_id: str | None = None,
    ) -> tuple[list[SessionMessage], int | None]:
        messages = [
            message
            for message in self._repository.list_by_session(session_id)
            if after_cursor is None or message.cursor > after_cursor
        ]
        if timeline_id is not None:
            messages = [message for message in messages if message.timeline_id in (None, timeline_id)]
        page = messages[:limit]
        next_cursor = page[-1].cursor if len(messages) > limit and page else None
        return page, next_cursor

    def get_message(self, message_id: str) -> SessionMessage:
        message = self._repository.get(message_id)
        if message is not None:
            return message
        raise MessageNotFound(message_id)


def _message_from_dict(record: dict[str, object]) -> SessionMessage:
    from datetime import datetime

    return SessionMessage(
        id=str(record["id"]),
        session_id=str(record["session_id"]),
        timeline_id=str(record["timeline_id"]) if record.get("timeline_id") is not None else None,
        group_id=str(record["group_id"]) if record.get("group_id") is not None else None,
        cursor=int(record["cursor"]),
        role=MessageRole(str(record["role"])),
        content=str(record["content"]),
        status=MessageStatus(str(record["status"])),
        token_count=int(record.get("token_count", 0)),
        context_group_ids=[str(item) for item in record.get("context_group_ids", [])],
        checkpoint_id=str(record["checkpoint_id"]) if record.get("checkpoint_id") is not None else None,
        trace_id=str(record["trace_id"]) if record.get("trace_id") is not None else None,
        tool_call_ids=[str(item) for item in record.get("tool_call_ids", [])],
        tool_result_ids=[str(item) for item in record.get("tool_result_ids", [])],
        created_at=datetime.fromisoformat(str(record["created_at"])),
    )
