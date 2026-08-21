from contextos.context.model.placeholder import Placeholder
from contextos.provider.base.ir import ContextPlaceholder


def render_placeholder(placeholder: Placeholder) -> ContextPlaceholder:
    return ContextPlaceholder(
        placeholder_id=placeholder.id,
        group_id=placeholder.group_id,
        summary=placeholder.summary,
        restorable=placeholder.restorable,
        placeholder_type=placeholder.type,
        source_count=placeholder.source_count,
        original_tokens=placeholder.original_tokens,
        current_tokens=placeholder.current_tokens,
        reason=placeholder.reason,
    )
