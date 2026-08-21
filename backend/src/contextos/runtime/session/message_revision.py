from dataclasses import dataclass
from datetime import datetime

from contextos.runtime.session.model import utc_now


@dataclass(frozen=True)
class MessageRevision:
    id: str
    message_id: str
    session_id: str
    revision_number: int
    original_content: str
    previous_content: str
    new_content: str
    operator: str
    reason: str
    timeline_id: str | None
    context_revision_id: str | None
    previous_revision_id: str | None
    created_at: datetime

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "message_id": self.message_id,
            "session_id": self.session_id,
            "revision_number": self.revision_number,
            "original_content": self.original_content,
            "previous_content": self.previous_content,
            "new_content": self.new_content,
            "operator": self.operator,
            "reason": self.reason,
            "timeline_id": self.timeline_id,
            "context_revision_id": self.context_revision_id,
            "previous_revision_id": self.previous_revision_id,
            "created_at": self.created_at.isoformat(),
        }


def new_revision_timestamp() -> datetime:
    return utc_now()
