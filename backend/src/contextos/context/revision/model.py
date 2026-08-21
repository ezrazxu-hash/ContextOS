from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum


class RevisionType(Enum):
    USER_EDIT = "USER_EDIT"
    SYSTEM_ABSTRACT = "SYSTEM_ABSTRACT"
    SYSTEM_EVICT = "SYSTEM_EVICT"
    USER_RESTORE = "USER_RESTORE"
    AGENT_RESTORE = "AGENT_RESTORE"
    USER_PIN = "USER_PIN"
    USER_UNPIN = "USER_UNPIN"


@dataclass(frozen=True)
class ContextRevision:
    id: str
    context_item_id: str
    revision_type: RevisionType
    old_value: str | None
    new_value: str | None
    operator: str
    created_at: datetime
    reason: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)

