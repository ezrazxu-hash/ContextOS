from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class Checkpoint:
    id: str
    session_id: str
    timeline_id: str
    graph_state: dict[str, object]
    message_cursor: int
    context_revision: str
    created_at: datetime
    parent_checkpoint_id: str | None = None
    agent_template_id: str | None = None
    agent_version_id: str | None = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)

