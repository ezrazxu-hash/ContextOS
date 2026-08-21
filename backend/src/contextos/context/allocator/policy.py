from enum import Enum

from contextos.context.group.model import ContextGroup, ContextGroupType
from contextos.context.model.enums import ContextItemState


LARGE_GROUP_TOKEN_THRESHOLD = 8000


class AllocationAction(str, Enum):
    KEEP = "KEEP"
    ABSTRACT = "ABSTRACT"
    EVICT = "EVICT"


class AllocatorPolicy:
    def choose_action(
        self,
        group: ContextGroup,
        *,
        current_user_item_id: str | None = None,
        current_node_input_item_ids: list[str] | None = None,
    ) -> AllocationAction:
        protected_item_ids = set(current_node_input_item_ids or [])
        if current_user_item_id is not None:
            protected_item_ids.add(current_user_item_id)

        if group.state == ContextItemState.PINNED:
            return AllocationAction.KEEP
        if protected_item_ids.intersection(group.item_ids):
            return AllocationAction.KEEP
        if group.summary and group.state == ContextItemState.RAW:
            return AllocationAction.EVICT
        if (
            group.group_type == ContextGroupType.TOOL_INTERACTION
            and group.source_token_count >= LARGE_GROUP_TOKEN_THRESHOLD
            and group.state == ContextItemState.RAW
        ):
            return AllocationAction.ABSTRACT
        return AllocationAction.KEEP

