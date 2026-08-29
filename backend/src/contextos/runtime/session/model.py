from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class SessionStatus(Enum):
    ACTIVE = "active"


@dataclass(frozen=True)
class Session:
    id: str
    workspace_id: str | None
    agent_template_id: str
    current_timeline_id: str | None
    created_at: datetime
    status: SessionStatus
    title: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "workspace_id": self.workspace_id,
            "agent_template_id": self.agent_template_id,
            "current_timeline_id": self.current_timeline_id,
            "created_at": self.created_at.isoformat(),
            "status": self.status.value,
            "title": self.title,
            "metadata": dict(self.metadata),
        }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
