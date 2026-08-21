from dataclasses import dataclass, field
from typing import Callable

from contextos.context.group.model import ContextGroup
from contextos.context.restore.policy import RestorePolicy
from contextos.context.restore.search import ContextSearchQuery, ContextSearchResult, search_context_groups
from contextos.context.restore.service import ContextRestoreService, RestoreRequest, RestoreTurnState
from contextos.runtime.graph.runtime_context import RuntimeContext


@dataclass(frozen=True)
class AgentRestoreResult:
    status: str
    continue_run: bool
    pending_approval: bool = False
    reason: str | None = None
    final_tokens: int | None = None
    trace_events: list[str] = field(default_factory=list)


class AgentContextAPI:
    def __init__(
        self,
        groups: list[ContextGroup],
        restore_service: ContextRestoreService,
        restore_policy: RestorePolicy,
        turn_state: RestoreTurnState,
        runtime_context: RuntimeContext,
        reallocator: Callable[[str, str], object] | None = None,
    ) -> None:
        self._groups = list(groups)
        self._restore_service = restore_service
        self._restore_policy = restore_policy
        self._turn_state = turn_state
        self._runtime_context = runtime_context
        self._reallocator = reallocator

    def search(self, keyword: str) -> list[ContextSearchResult]:
        return search_context_groups(
            self._groups,
            ContextSearchQuery(keyword=keyword, timeline_id=self._runtime_context.timeline_id),
        )

    def restore(self, group_id: str, token_count: int) -> AgentRestoreResult:
        trace_events = [f"agent_restore_requested:{group_id}"]
        if self._reallocator is not None:
            reallocation = self._reallocator(group_id, "agent")
            if reallocation.status == "restored":
                return AgentRestoreResult(
                    status="restored",
                    continue_run=True,
                    final_tokens=reallocation.final_tokens,
                    trace_events=[
                        *trace_events,
                        *reallocation.trace_events,
                        f"agent_restore_restored:{group_id}",
                    ],
                )
            return AgentRestoreResult(
                status=reallocation.status,
                continue_run=False,
                reason=reallocation.reason,
                final_tokens=reallocation.final_tokens,
                trace_events=[
                    *trace_events,
                    *reallocation.trace_events,
                    f"agent_restore_rejected:{group_id}",
                ],
            )

        result = self._restore_service.request_restore(
            RestoreRequest(group_id=group_id, token_count=token_count, actor="agent"),
            self._restore_policy,
            self._turn_state,
        )
        if result.status == "restored":
            trace_events.append(f"agent_restore_restored:{group_id}")
            return AgentRestoreResult(status="restored", continue_run=True, trace_events=trace_events)
        if result.pending_approval:
            trace_events.append(f"agent_restore_pending_approval:{group_id}")
            return AgentRestoreResult(
                status=result.status,
                continue_run=False,
                pending_approval=True,
                trace_events=trace_events,
            )
        trace_events.append(f"agent_restore_rejected:{group_id}")
        return AgentRestoreResult(
            status=result.status,
            continue_run=False,
            reason=result.reason,
            trace_events=trace_events,
        )
