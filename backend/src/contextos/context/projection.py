from contextos.context.model.item import ContextItem
from contextos.context.revision.model import ContextRevision
from contextos.provider.base.token_counter import count_text_tokens


def project_context_item(item: ContextItem) -> dict[str, object]:
    return {
        "id": item.id,
        "session_id": item.session_id,
        "timeline_id": item.timeline_id,
        "group_id": item.group_id,
        "type": item.type.value,
        "state": item.state.value,
        "raw_content": item.raw_content,
        "generated_content": item.generated_content,
        "user_override": item.user_override,
        "effective_content": item.effective_content,
        "source_ids": list(item.source_ids),
        "source": source_metadata(item.source_ids),
        "token_count_raw": item.token_count_raw,
        "token_count_effective": count_text_tokens(item.effective_content),
        "priority": item.priority,
        "restorable": item.restorable,
    }


def source_metadata(source_ids: list[str]) -> dict[str, object]:
    source_type = "external" if any(source_id.startswith("external:") for source_id in source_ids) else "internal"
    trust = "unverified" if source_type == "external" else "trusted"
    return {
        "ids": list(source_ids),
        "type": source_type,
        "trust": trust,
    }


def project_revision(revision: ContextRevision) -> dict[str, object]:
    return {
        "id": revision.id,
        "context_item_id": revision.context_item_id,
        "revision_type": revision.revision_type.value,
        "old_value": revision.old_value,
        "new_value": revision.new_value,
        "operator": revision.operator,
        "created_at": revision.created_at.isoformat(),
        "reason": revision.reason,
    }
