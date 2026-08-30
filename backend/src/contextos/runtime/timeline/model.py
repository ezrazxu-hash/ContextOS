from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum


class TimelineStatus(Enum):
    ACTIVE = "active"
    DELETED = "deleted"


@dataclass(frozen=True)
class Timeline:
    id: str
    session_id: str
    parent_timeline_id: str | None
    fork_checkpoint_id: str | None
    fork_message_id: str | None
    created_at: datetime
    status: TimelineStatus
    title: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "parent_timeline_id": self.parent_timeline_id,
            "fork_checkpoint_id": self.fork_checkpoint_id,
            "fork_message_id": self.fork_message_id,
            "created_at": self.created_at.isoformat(),
            "status": self.status.value,
            "title": self.title,
        }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)

