from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class ConversationGroupState(Enum):
    ACTIVE = "ACTIVE"
    COMPRESSED = "COMPRESSED"
    EXCLUDED = "EXCLUDED"
    DELETED = "DELETED"


@dataclass(frozen=True)
class ConversationGroup:
    id: str
    session_id: str
    timeline_id: str
    cursor: int
    state: ConversationGroupState
    message_ids: list[str]
    summary: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "timeline_id": self.timeline_id,
            "cursor": self.cursor,
            "state": self.state.value,
            "message_ids": list(self.message_ids),
            "summary": self.summary,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
