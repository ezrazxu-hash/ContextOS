from dataclasses import replace

from contextos.context.group.model import ContextGroup, utc_now
from contextos.context.model.enums import ContextItemState
from contextos.context.model.item import ContextItem


def item_with_state(item: ContextItem, state: ContextItemState) -> ContextItem:
    return replace(item, state=state, updated_at=utc_now())


def item_with_generated_content(item: ContextItem, generated_content: str) -> ContextItem:
    return replace(
        item,
        state=ContextItemState.ABSTRACT,
        generated_content=generated_content,
        token_count_effective=len(generated_content.split()),
        updated_at=utc_now(),
    )


def item_with_user_override(item: ContextItem, user_override: str) -> ContextItem:
    return replace(
        item,
        user_override=user_override,
        token_count_effective=len(user_override.split()),
        updated_at=utc_now(),
    )


def item_without_user_override(item: ContextItem) -> ContextItem:
    restored_content = item.generated_content or item.raw_content
    return replace(
        item,
        user_override=None,
        token_count_effective=len(restored_content.split()),
        updated_at=utc_now(),
    )


def group_with_state(group: ContextGroup, state: ContextItemState) -> ContextGroup:
    return replace(group, state=state, updated_at=utc_now())


def group_with_placeholder(group: ContextGroup, placeholder_id: str) -> ContextGroup:
    return replace(group, placeholder=placeholder_id, updated_at=utc_now())
