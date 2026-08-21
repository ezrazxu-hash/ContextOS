from dataclasses import dataclass

from contextos.context.group.service import ContextGroupService
from contextos.context.restore.policy import RestoreMode, RestorePolicy
from contextos.context.revision.model import RevisionType


@dataclass(frozen=True)
class RestoreRequest:
    group_id: str
    token_count: int
    actor: str


@dataclass
class RestoreTurnState:
    restore_count: int = 0


@dataclass(frozen=True)
class RestoreResult:
    status: str
    pending_approval: bool = False
    reason: str | None = None


class ContextRestoreService:
    def __init__(self, group_service: ContextGroupService) -> None:
        self._group_service = group_service

    def request_restore(
        self,
        request: RestoreRequest,
        policy: RestorePolicy,
        turn_state: RestoreTurnState,
    ) -> RestoreResult:
        if request.token_count > policy.max_tokens_per_restore:
            return RestoreResult(status="rejected", reason="max_tokens_per_restore_exceeded")
        if turn_state.restore_count >= policy.max_restore_per_turn:
            return RestoreResult(status="rejected", reason="max_restore_per_turn_exceeded")

        if policy.mode == RestoreMode.MANUAL:
            return RestoreResult(status="manual_required")
        if policy.mode == RestoreMode.ASK:
            return RestoreResult(status="pending_approval", pending_approval=True)

        revision_type = RevisionType.AGENT_RESTORE if request.actor == "agent" else RevisionType.USER_RESTORE
        self._group_service.restore_group(
            request.group_id,
            operator=request.actor,
            reason="restore",
            revision_type=revision_type,
        )
        turn_state.restore_count += 1
        return RestoreResult(status="restored")
