from dataclasses import dataclass, field
from typing import Callable
from uuid import uuid4

from contextos.runtime.checkpoint.service import CheckpointService
from contextos.runtime.timeline.service import TimelineService
from contextos.runtime.trace.collector import TraceCollector
from contextos.tool.registry.registry import ToolRegistry
from contextos.tool.replay.decision import ReplayDecision
from contextos.tool.replay.policy import ReplayDecisionPolicy


@dataclass(frozen=True)
class ReplayPlan:
    parent_timeline_id: str
    fork_checkpoint_id: str
    fork_message_id: str
    decisions: list[ReplayDecision]
    idempotency_key: str


@dataclass(frozen=True)
class ReplayResult:
    status: str
    timeline_id: str | None = None
    trace_id: str | None = None
    checkpoint_id: str | None = None
    executed_tool_call_ids: list[str] = field(default_factory=list)
    rejected_tool_call_ids: list[str] = field(default_factory=list)
    rejection_reasons: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "timeline_id": self.timeline_id,
            "trace_id": self.trace_id,
            "checkpoint_id": self.checkpoint_id,
            "executed_tool_call_ids": list(self.executed_tool_call_ids),
            "rejected_tool_call_ids": list(self.rejected_tool_call_ids),
            "rejection_reasons": dict(self.rejection_reasons),
        }


class ReplayManager:
    def __init__(
        self,
        timeline_service: TimelineService,
        checkpoint_service: CheckpointService,
        trace_collector: TraceCollector,
        tool_registry: ToolRegistry,
        impact_analyzer: Callable[[], object],
        tool_executor: Callable[[ReplayDecision], object],
    ) -> None:
        self._timeline_service = timeline_service
        self._checkpoint_service = checkpoint_service
        self._trace_collector = trace_collector
        self._tool_registry = tool_registry
        self._impact_analyzer = impact_analyzer
        self._tool_executor = tool_executor
        self._policy = ReplayDecisionPolicy()
        self._results_by_idempotency_key: dict[str, ReplayResult] = {}

    def execute_plan(self, plan: ReplayPlan) -> ReplayResult:
        cached = self._results_by_idempotency_key.get(plan.idempotency_key)
        if cached is not None:
            return cached

        self._impact_analyzer()
        rejected = self._rejection_reasons(plan.decisions)
        if rejected:
            result = ReplayResult(
                status="rejected",
                rejected_tool_call_ids=list(rejected.keys()),
                rejection_reasons=rejected,
            )
            self._results_by_idempotency_key[plan.idempotency_key] = result
            return result

        timeline = self._timeline_service.fork_timeline(
            parent_timeline_id=plan.parent_timeline_id,
            fork_checkpoint_id=plan.fork_checkpoint_id,
            fork_message_id=plan.fork_message_id,
        )
        self._timeline_service.activate_timeline(timeline.id)

        executed: list[str] = []
        for decision in plan.decisions:
            metadata = self._metadata_for(decision)
            policy_result = self._policy.evaluate(decision, metadata)
            if policy_result.should_execute_tool:
                self._tool_executor(decision)
                executed.append(decision.tool_call_id)

        checkpoint = self._checkpoint_service.save_checkpoint(
            session_id=timeline.session_id,
            timeline_id=timeline.id,
            graph_state={"replay": True, "executed_tool_call_ids": list(executed)},
            message_cursor=0,
            context_revision="replay",
            parent_checkpoint_id=plan.fork_checkpoint_id,
        )
        trace_id = f"trace_{uuid4().hex}"
        self._trace_collector.record_tool_call(
            trace_id=trace_id,
            session_id=timeline.session_id,
            timeline_id=timeline.id,
            checkpoint_id=checkpoint.id,
            component="replay",
            input_payload={"executed_tool_call_ids": executed},
            duration=0,
            message_id=plan.fork_message_id,
        )
        result = ReplayResult(
            status="completed",
            timeline_id=timeline.id,
            trace_id=trace_id,
            checkpoint_id=checkpoint.id,
            executed_tool_call_ids=executed,
            rejected_tool_call_ids=[],
        )
        self._results_by_idempotency_key[plan.idempotency_key] = result
        return result

    def _rejection_reasons(self, decisions: list[ReplayDecision]) -> dict[str, str]:
        rejected: dict[str, str] = {}
        for decision in decisions:
            metadata = self._metadata_for(decision)
            policy_result = self._policy.evaluate(decision, metadata)
            if not policy_result.allowed:
                rejected[decision.tool_call_id] = policy_result.reason
        return rejected

    def _metadata_for(self, decision: ReplayDecision):
        return self._tool_registry.get(decision.tool_id or decision.tool_call_id)
