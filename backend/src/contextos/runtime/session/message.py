from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from contextos.runtime.session.model import utc_now


class MessageRole(Enum):
    USER = "user"
    ASSISTANT = "assistant"


class MessageStatus(Enum):
    COMPLETED = "completed"


@dataclass(frozen=True)
class SessionMessage:
    id: str
    session_id: str
    cursor: int
    role: MessageRole
    content: str
    status: MessageStatus
    token_count: int
    timeline_id: str | None = None
    group_id: str | None = None
    context_group_ids: list[str] = field(default_factory=list)
    checkpoint_id: str | None = None
    trace_id: str | None = None
    tool_call_ids: list[str] = field(default_factory=list)
    tool_result_ids: list[str] = field(default_factory=list)
    revision_id: str | None = None
    user_modified: bool = False
    is_deleted: bool = False
    deleted_at: datetime | None = None
    created_at: datetime = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "timeline_id": self.timeline_id,
            "group_id": self.group_id,
            "cursor": self.cursor,
            "role": self.role.value,
            "content": self.content,
            "status": self.status.value,
            "token_count": self.token_count,
            "context_group_ids": list(self.context_group_ids),
            "checkpoint_id": self.checkpoint_id,
            "trace_id": self.trace_id,
            "tool_call_ids": list(self.tool_call_ids),
            "tool_result_ids": list(self.tool_result_ids),
            "revision_id": self.revision_id,
            "user_modified": self.user_modified,
            "is_deleted": self.is_deleted,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at is not None else None,
            "created_at": self.created_at.isoformat(),
        }
