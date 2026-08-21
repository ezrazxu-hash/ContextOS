from dataclasses import dataclass, field

from contextos.context.allocator.policy import AllocationAction, AllocatorPolicy
from contextos.context.group.model import ContextGroup


@dataclass(frozen=True)
class AllocationPlan:
    keep_group_ids: list[str] = field(default_factory=list)
    abstract_group_ids: list[str] = field(default_factory=list)
    evict_group_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, list[str]]:
        return {
            "keep_group_ids": list(self.keep_group_ids),
            "abstract_group_ids": list(self.abstract_group_ids),
            "evict_group_ids": list(self.evict_group_ids),
        }


class ContextAllocator:
    def __init__(self, policy: AllocatorPolicy | None = None) -> None:
        self._policy = policy or AllocatorPolicy()

    def plan(
        self,
        groups: list[ContextGroup],
        *,
        current_user_item_id: str | None = None,
        current_node_input_item_ids: list[str] | None = None,
    ) -> AllocationPlan:
        keep: list[str] = []
        abstract: list[str] = []
        evict: list[str] = []

        for group in groups:
            action = self._policy.choose_action(
                group,
                current_user_item_id=current_user_item_id,
                current_node_input_item_ids=current_node_input_item_ids,
            )
            if action == AllocationAction.EVICT:
                evict.append(group.id)
            elif action == AllocationAction.ABSTRACT:
                abstract.append(group.id)
            else:
                keep.append(group.id)

        return AllocationPlan(
            keep_group_ids=keep,
            abstract_group_ids=abstract,
            evict_group_ids=evict,
        )
