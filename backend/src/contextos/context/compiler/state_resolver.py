from contextos.context.compiler.placeholder_renderer import render_placeholder
from contextos.context.model.enums import ContextItemState, ContextItemType
from contextos.context.model.item import ContextItem
from contextos.context.model.placeholder import Placeholder
from contextos.provider.base.ir import ContextReference, SystemInstruction, UserMessage


def resolve_context_items(
    items: list[ContextItem],
    *,
    selected_item_ids: list[str] | None = None,
    placeholders_by_group_id: dict[str, Placeholder] | None = None,
) -> list[object]:
    selected = set(selected_item_ids) if selected_item_ids is not None else None
    placeholders = placeholders_by_group_id or {}
    resolved: list[object] = []
    rendered_placeholder_groups: set[str] = set()

    for item in items:
        if selected is not None and item.id not in selected and item.state != ContextItemState.PINNED:
            continue

        if item.state == ContextItemState.EVICTED:
            placeholder = placeholders.get(item.group_id)
            if placeholder is not None and item.group_id not in rendered_placeholder_groups:
                resolved.append(render_placeholder(placeholder))
                rendered_placeholder_groups.add(item.group_id)
            continue

        if item.state == ContextItemState.REFERENCE:
            resolved.append(
                ContextReference(
                    reference_id=f"reference_{item.id}",
                    target_id=item.id,
                    label=item.group_id,
                )
            )
            continue

        if item.state == ContextItemState.ABSTRACT:
            content = item.user_override or item.generated_content or ""
        else:
            content = item.effective_content

        resolved.append(_message_for_item(item, content))

    return resolved


def _message_for_item(item: ContextItem, content: str) -> object:
    if item.type == ContextItemType.SYSTEM:
        return SystemInstruction(content=content)
    return UserMessage(content=content)
