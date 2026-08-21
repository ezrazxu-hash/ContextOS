from uuid import uuid4

from contextos.context.group.model import ContextGroup
from contextos.context.model.placeholder import Placeholder


class PlaceholderService:
    def __init__(self) -> None:
        self._groups_by_id: dict[str, ContextGroup] = {}

    def create_for_group(self, group: ContextGroup, reason: str) -> Placeholder:
        self._groups_by_id[group.id] = group
        summary = group.summary or ""
        return Placeholder(
            id=f"placeholder_{uuid4().hex}",
            group_id=group.id,
            type=group.group_type.value,
            summary=summary,
            source_count=len(group.item_ids),
            original_tokens=group.source_token_count,
            current_tokens=count_summary_tokens(summary),
            restorable=group.restorable,
            reason=reason,
        )

    def get_source_group(self, group_id: str) -> ContextGroup | None:
        return self._groups_by_id.get(group_id)


def count_summary_tokens(summary: str) -> int:
    return len([token for token in summary.split() if token])

