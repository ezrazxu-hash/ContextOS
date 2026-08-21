from dataclasses import dataclass, field

from contextos.context.group.service import ContextGroupService
from contextos.context.model.enums import ContextItemState
from contextos.context.revision.model import RevisionType


@dataclass(frozen=True)
class RestoreReallocationRequest:
    target_group_id: str
    max_tokens: int
    protected_group_ids: list[str]
    actor: str


@dataclass(frozen=True)
class RestoreReallocationPlan:
    target_group_id: str
    max_tokens: int
    actor: str
    evict_group_ids: list[str]
    final_tokens: int
    budget_pressure: bool
    protected_group_ids: list[str]
    trace_events: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RestoreReallocationResult:
    status: str
    final_tokens: int
    trace_events: list[str]
    reason: str | None = None


class RestoreReallocator:
    def __init__(self, group_service: ContextGroupService) -> None:
        self._group_service = group_service

    def plan(self, request: RestoreReallocationRequest) -> RestoreReallocationPlan:
        groups = self._group_service.groups
        target = groups[request.target_group_id]
        current_tokens = sum(
            group.effective_token_count
            for group_id, group in groups.items()
            if group_id != request.target_group_id
        )
        final_tokens = current_tokens + target.source_token_count
        evict_group_ids: list[str] = []

        for group in groups.values():
            if final_tokens <= request.max_tokens:
                break
            if group.id == request.target_group_id:
                continue
            if group.id in request.protected_group_ids:
                continue
            if group.state == ContextItemState.PINNED:
                continue
            if group.state == ContextItemState.EVICTED:
                continue
            if not group.summary:
                continue
            evict_group_ids.append(group.id)
            final_tokens -= group.effective_token_count

        return RestoreReallocationPlan(
            target_group_id=request.target_group_id,
            max_tokens=request.max_tokens,
            actor=request.actor,
            evict_group_ids=evict_group_ids,
            final_tokens=final_tokens,
            budget_pressure=final_tokens > request.max_tokens,
            protected_group_ids=list(request.protected_group_ids),
            trace_events=["restore_planned"],
        )

    def apply(self, plan: RestoreReallocationPlan) -> RestoreReallocationResult:
        if plan.budget_pressure:
            return RestoreReallocationResult(
                status="rejected",
                final_tokens=plan.final_tokens,
                trace_events=[*plan.trace_events, "restore_rejected"],
                reason="budget_pressure",
            )

        item_snapshot = dict(self._group_service.items)
        group_snapshot = dict(self._group_service.groups)
        revision_snapshot = _revision_snapshot(self._group_service)

        try:
            trace_events = [*plan.trace_events]
            for group_id in plan.evict_group_ids:
                self._group_service.evict_group(group_id, operator=plan.actor, reason="restore reallocation")
                trace_events.append(f"evicted:{group_id}")

            revision_type = RevisionType.AGENT_RESTORE if plan.actor == "agent" else RevisionType.USER_RESTORE
            self._group_service.restore_group(
                plan.target_group_id,
                operator=plan.actor,
                reason="restore reallocation",
                revision_type=revision_type,
            )
            trace_events.append(f"restored:{plan.target_group_id}")
            return RestoreReallocationResult(status="restored", final_tokens=plan.final_tokens, trace_events=trace_events)
        except Exception as exc:
            self._group_service.items.clear()
            self._group_service.items.update(item_snapshot)
            self._group_service.groups.clear()
            self._group_service.groups.update(group_snapshot)
            _restore_revision_snapshot(self._group_service, revision_snapshot)
            return RestoreReallocationResult(
                status="failed",
                final_tokens=plan.final_tokens,
                trace_events=[*plan.trace_events, "restore_rollback"],
                reason=str(exc),
            )


def _revision_snapshot(group_service: ContextGroupService):
    repository = group_service._revision_service._repository
    return list(repository._revisions)


def _restore_revision_snapshot(group_service: ContextGroupService, snapshot) -> None:
    repository = group_service._revision_service._repository
    repository._revisions = list(snapshot)
