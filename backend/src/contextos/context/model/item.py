from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

from contextos.context.model.enums import ContextItemState, ContextItemType


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class ContextItem:
    id: str
    session_id: str
    timeline_id: str
    group_id: str
    type: ContextItemType
    state: ContextItemState
    raw_content: str
    generated_content: str | None
    user_override: str | None
    source_ids: list[str]
    token_count_raw: int
    token_count_effective: int
    priority: int
    restorable: bool
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    @property
    def effective_content(self) -> str:
        return self.user_override or self.generated_content or self.raw_content

    def with_state(self, state: ContextItemState) -> "ContextItem":
        return replace(self, state=state, updated_at=utc_now())
