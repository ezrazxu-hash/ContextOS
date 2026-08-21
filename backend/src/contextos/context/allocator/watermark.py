from dataclasses import dataclass, field

from contextos.context.allocator.policy import AllocationAction, AllocatorPolicy
from contextos.context.group.model import ContextGroup


@dataclass(frozen=True)
class WatermarkPlan:
    triggered: bool
    budget_pressure: bool
    current_tokens: int
    target_tokens: int
    planned_tokens: int
    abstract_group_ids: list[str] = field(default_factory=list)
    evict_group_ids: list[str] = field(default_factory=list)
    reason: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "triggered": self.triggered,
            "budget_pressure": self.budget_pressure,
            "current_tokens": self.current_tokens,
            "target_tokens": self.target_tokens,
            "planned_tokens": self.planned_tokens,
            "abstract_group_ids": list(self.abstract_group_ids),
            "evict_group_ids": list(self.evict_group_ids),
            "reason": self.reason,
        }


class WatermarkPlanner:
    def __init__(
        self,
        high_watermark: float = 0.8,
        target_watermark: float = 0.65,
        policy: AllocatorPolicy | None = None,
    ) -> None:
        self.high_watermark = high_watermark
        self.target_watermark = target_watermark
        self._policy = policy or AllocatorPolicy()

    def plan(self, groups: list[ContextGroup], max_tokens: int) -> WatermarkPlan:
        current_tokens = sum(group.effective_token_count for group in groups)
        target_tokens = int(max_tokens * self.target_watermark)
        if current_tokens <= int(max_tokens * self.high_watermark):
            return WatermarkPlan(
                triggered=False,
                budget_pressure=False,
                current_tokens=current_tokens,
                target_tokens=target_tokens,
                planned_tokens=current_tokens,
            )

        planned_tokens = current_tokens
        abstract_group_ids: list[str] = []
        evict_group_ids: list[str] = []

        for group in groups:
            if planned_tokens <= target_tokens:
                break
            action = self._policy.choose_action(group)
            if action == AllocationAction.EVICT:
                evict_group_ids.append(group.id)
                planned_tokens -= group.effective_token_count
            elif action == AllocationAction.ABSTRACT:
                abstract_group_ids.append(group.id)
                planned_tokens -= group.effective_token_count // 2

        budget_pressure = planned_tokens > target_tokens
        return WatermarkPlan(
            triggered=True,
            budget_pressure=budget_pressure,
            current_tokens=current_tokens,
            target_tokens=target_tokens,
            planned_tokens=planned_tokens,
            abstract_group_ids=abstract_group_ids,
            evict_group_ids=evict_group_ids,
            reason="cannot_reach_target_watermark" if budget_pressure else None,
        )
