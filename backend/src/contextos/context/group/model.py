from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from contextos.context.model.enums import ContextItemState


class ContextGroupType(Enum):
    MESSAGE_GROUP = "MESSAGE_GROUP"
    TOOL_INTERACTION = "TOOL_INTERACTION"
    AGENT_STEP = "AGENT_STEP"
    SUBTASK = "SUBTASK"
    RESOURCE_INTERACTION = "RESOURCE_INTERACTION"
    HUMAN_APPROVAL = "HUMAN_APPROVAL"
    CUSTOM_GROUP = "CUSTOM_GROUP"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class ContextGroup:
    id: str
    session_id: str
    timeline_id: str
    group_type: ContextGroupType
    item_ids: list[str]
    atomic: bool
    state: ContextItemState
    summary: str | None
    placeholder: str | None
    source_token_count: int
    effective_token_count: int
    restorable: bool
    dependencies: list[str]
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

