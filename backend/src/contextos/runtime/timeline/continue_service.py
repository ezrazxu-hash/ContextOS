from dataclasses import dataclass
from typing import Callable

from contextos.runtime.graph.executor import ExecutionResult, RuntimeExecutor
from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.timeline.model import Timeline
from contextos.runtime.timeline.service import TimelineService
from contextos.runtime.checkpoint.service import CheckpointService


@dataclass(frozen=True)
class ContinueResult:
    timeline: Timeline
    execution: ExecutionResult


class ContinueService:
    def __init__(
        self,
        timeline_service: TimelineService,
        checkpoint_service: CheckpointService,
        runtime_executor: RuntimeExecutor,
    ) -> None:
        self._timeline_service = timeline_service
        self._checkpoint_service = checkpoint_service
        self._runtime_executor = runtime_executor

    def continue_from_revision(
        self,
        *,
        parent_timeline_id: str,
        message_id: str,
        revision_id: str,
        checkpoint_id: str,
        trace_id: str,
        revision_service: MessageRevisionService,
        old_tool_replayer: Callable[[], object] | None = None,
    ) -> ContinueResult:
        del old_tool_replayer
        checkpoint = self._checkpoint_service.restore_checkpoint(checkpoint_id)
        revision = revision_service.get_revision(revision_id)
        timeline = self._timeline_service.fork_timeline(
            parent_timeline_id=parent_timeline_id,
            fork_checkpoint_id=checkpoint.id,
            fork_message_id=message_id,
        )
        self._timeline_service.activate_timeline(timeline.id)
        graph_state = {
            **checkpoint.graph_state,
            "message_revisions": {
                **dict(checkpoint.graph_state.get("message_revisions", {})),
                message_id: revision.new_content,
            },
        }
        execution = self._runtime_executor.run(
            session_id=checkpoint.session_id,
            timeline_id=timeline.id,
            trace_id=trace_id,
            graph_state=graph_state,
            message_cursor=checkpoint.message_cursor,
            context_revision=checkpoint.context_revision,
            parent_checkpoint_id=checkpoint.id,
        )
        return ContinueResult(timeline=timeline, execution=execution)
