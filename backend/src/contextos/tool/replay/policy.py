from dataclasses import dataclass, field
from typing import Any

from contextos.tool.registry.metadata import SideEffect, ToolMetadata
from contextos.tool.replay.decision import ReplayAction, ReplayDecision


HIGH_RISK_SIDE_EFFECTS = {
    SideEffect.WRITE,
    SideEffect.EXTERNAL_WRITE,
    SideEffect.DESTRUCTIVE,
    SideEffect.FINANCIAL,
}


@dataclass(frozen=True)
class ReplayPolicyResult:
    allowed: bool
    should_execute_tool: bool
    reason: str
    provenance: dict[str, Any] = field(default_factory=dict)


class ReplayDecisionPolicy:
    def evaluate(self, decision: ReplayDecision, metadata: ToolMetadata) -> ReplayPolicyResult:
        if decision.action == ReplayAction.USE_HISTORY:
            return ReplayPolicyResult(
                allowed=True,
                should_execute_tool=False,
                reason="use_history",
                provenance=dict(decision.provenance),
            )

        if decision.action == ReplayAction.CANCEL:
            return ReplayPolicyResult(allowed=True, should_execute_tool=False, reason="cancel")

        if decision.action == ReplayAction.SKIP:
            return ReplayPolicyResult(allowed=True, should_execute_tool=False, reason="skip")

        if metadata.side_effect in HIGH_RISK_SIDE_EFFECTS and not decision.confirmation_token:
            return ReplayPolicyResult(
                allowed=False,
                should_execute_tool=False,
                reason="confirmation_required",
            )

        return ReplayPolicyResult(allowed=True, should_execute_tool=True, reason="reinvoke")
