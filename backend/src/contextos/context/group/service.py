from contextos.context.group.model import ContextGroup
from contextos.context.group.placeholder_service import PlaceholderService
from contextos.context.model.enums import ContextItemState
from contextos.context.model.item import ContextItem
from contextos.context.model.placeholder import Placeholder
from contextos.context.policy.state_machine import (
    item_with_generated_content,
    item_with_state,
    item_with_user_override,
    item_without_user_override,
    group_with_state,
    group_with_placeholder,
)
from contextos.context.revision.model import RevisionType
from contextos.context.revision.service import ContextRevisionService


class ContextGroupOperationError(Exception):
    pass


class ContextGroupService:
    def __init__(
        self,
        items: dict[str, ContextItem],
        groups: dict[str, ContextGroup],
        revision_service: ContextRevisionService,
        placeholder_service: PlaceholderService | None = None,
    ) -> None:
        self.items = items
        self.groups = groups
        self._revision_service = revision_service
        self._placeholder_service = placeholder_service or PlaceholderService()

    def view_raw(self, item_id: str) -> str:
        return self.items[item_id].raw_content

    def list_items_by_session(self, session_id: str) -> list[ContextItem]:
        return [item for item in self.items.values() if item.session_id == session_id]

    def list_revisions(self, item_id: str):
        return self._revision_service.list_revisions(item_id)

    def evict_group(self, group_id: str, operator: str, reason: str) -> Placeholder:
        group = self.groups[group_id]
        updates = {item_id: item_with_state(self.items[item_id], ContextItemState.EVICTED) for item_id in group.item_ids}
        self._commit_group_updates(group, updates, ContextItemState.EVICTED, RevisionType.SYSTEM_EVICT, operator, reason)
        placeholder = self._placeholder_service.create_for_group(self.groups[group_id], reason)
        self.groups[group_id] = group_with_placeholder(self.groups[group_id], placeholder.id)
        return placeholder

    def evict_item(self, item_id: str, operator: str, reason: str) -> None:
        item = self.items[item_id]
        group = self.groups[item.group_id]
        if group.atomic and len(group.item_ids) > 1:
            raise ContextGroupOperationError("context.atomic_group_partial_evict")
        self.evict_group(group.id, operator, reason)

    def abstract_group(self, group_id: str, generated_content_by_item_id: dict[str, str], operator: str, reason: str) -> None:
        group = self.groups[group_id]
        missing = [item_id for item_id in group.item_ids if item_id not in generated_content_by_item_id]
        if group.atomic and missing:
            raise ContextGroupOperationError(f"Missing generated content for atomic group members: {missing}")
        updates = {
            item_id: item_with_generated_content(self.items[item_id], generated_content_by_item_id[item_id])
            for item_id in group.item_ids
        }
        self._commit_group_updates(group, updates, ContextItemState.ABSTRACT, RevisionType.SYSTEM_ABSTRACT, operator, reason)

    def restore_group(
        self,
        group_id: str,
        operator: str,
        reason: str,
        revision_type: RevisionType = RevisionType.USER_RESTORE,
    ) -> None:
        group = self.groups[group_id]
        updates = {item_id: item_with_state(self.items[item_id], ContextItemState.RAW) for item_id in group.item_ids}
        self._commit_group_updates(group, updates, ContextItemState.RAW, revision_type, operator, reason)

    def pin_group(self, group_id: str, operator: str, reason: str) -> None:
        group = self.groups[group_id]
        updates = {item_id: item_with_state(self.items[item_id], ContextItemState.PINNED) for item_id in group.item_ids}
        self._commit_group_updates(group, updates, ContextItemState.PINNED, RevisionType.USER_PIN, operator, reason)

    def unpin_group(self, group_id: str, operator: str, reason: str) -> None:
        group = self.groups[group_id]
        updates = {item_id: item_with_state(self.items[item_id], ContextItemState.RAW) for item_id in group.item_ids}
        self._commit_group_updates(group, updates, ContextItemState.RAW, RevisionType.USER_UNPIN, operator, reason)

    def edit_item(self, item_id: str, user_override: str, operator: str, reason: str) -> None:
        old_item = self.items[item_id]
        new_item = item_with_user_override(old_item, user_override)
        self.items[item_id] = new_item
        self._revision_service.record_revision(
            item_id,
            RevisionType.USER_EDIT,
            old_item.effective_content,
            new_item.effective_content,
            operator,
            reason,
        )

    def restore_item_system_version(self, item_id: str, operator: str, reason: str) -> None:
        old_item = self.items[item_id]
        new_item = item_without_user_override(old_item)
        self.items[item_id] = new_item
        self._revision_service.record_revision(
            item_id,
            RevisionType.USER_RESTORE,
            old_item.effective_content,
            new_item.effective_content,
            operator,
            reason,
        )

    def _commit_group_updates(
        self,
        group: ContextGroup,
        updates: dict[str, ContextItem],
        new_group_state: ContextItemState,
        revision_type: RevisionType,
        operator: str,
        reason: str,
    ) -> None:
        for item_id, updated in updates.items():
            old_item = self.items[item_id]
            self.items[item_id] = updated
            self._revision_service.record_revision(
                item_id,
                revision_type,
                old_item.effective_content,
                updated.effective_content,
                operator,
                reason,
            )
        self.groups[group.id] = group_with_state(group, new_group_state)
