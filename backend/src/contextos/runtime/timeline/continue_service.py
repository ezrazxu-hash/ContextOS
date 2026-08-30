from dataclasses import dataclass
from typing import Callable

from contextos.runtime.conversation.service import ConversationGroupService
from contextos.runtime.graph.executor import ExecutionResult, RuntimeExecutor
from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.timeline.model import Timeline
from contextos.runtime.timeline.service import TimelineService
from contextos.runtime.checkpoint.service import CheckpointService
from contextos.runtime.timeline.edit_fork_service import fork_timeline_context


@dataclass(frozen=True)
class ContinueResult:
    timeline: Timeline
    execution: ExecutionResult


class ContinueAgentVersionNotFound(Exception):
    def __init__(self, agent_version_id: str) -> None:
        super().__init__(agent_version_id)
        self.agent_version_id = agent_version_id


class ContinueService:
    def __init__(
        self,
        timeline_service: TimelineService,
        checkpoint_service: CheckpointService,
        runtime_executor: RuntimeExecutor,
        message_service: MessageService | None = None,
        conversation_group_service: ConversationGroupService | None = None,
        agent_version_loader: Callable[[str], object | None] | None = None,
    ) -> None:
        self._timeline_service = timeline_service
        self._checkpoint_service = checkpoint_service
        self._runtime_executor = runtime_executor
        self._message_service = message_service
        self._conversation_group_service = conversation_group_service
        self._agent_version_loader = agent_version_loader

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
        if checkpoint.agent_version_id is not None and self._agent_version_loader is not None and self._agent_version_loader(checkpoint.agent_version_id) is None:
            raise ContinueAgentVersionNotFound(checkpoint.agent_version_id)
        revision = revision_service.get_revision(revision_id)
        timeline = self._timeline_service.fork_timeline(
            parent_timeline_id=parent_timeline_id,
            fork_checkpoint_id=checkpoint.id,
            fork_message_id=message_id,
        )
        self._timeline_service.activate_timeline(timeline.id)
        if self._message_service is not None and self._conversation_group_service is not None:
            message = self._message_service.get_message(message_id)
            fork_timeline_context(
                parent_timeline_id=parent_timeline_id,
                child_timeline_id=timeline.id,
                edited_message=message,
                edited_content=revision.new_content,
                message_service=self._message_service,
                conversation_group_service=self._conversation_group_service,
                include_edited_message=True,
                revision_id=revision.id,
            )
        graph_state = {
            **checkpoint.graph_state,
            "message_revisions": {
                **dict(checkpoint.graph_state.get("message_revisions", {})),
                message_id: revision.new_content,
            },
        }
        if checkpoint.agent_version_id is not None:
            graph_state["agent_version_id"] = checkpoint.agent_version_id
        execution = self._runtime_executor.run(
            session_id=checkpoint.session_id,
            timeline_id=timeline.id,
            trace_id=trace_id,
            graph_state=graph_state,
            message_cursor=checkpoint.message_cursor,
            context_revision=checkpoint.context_revision,
            parent_checkpoint_id=checkpoint.id,
            agent_template_id=checkpoint.agent_template_id,
            agent_version_id=checkpoint.agent_version_id,
        )
        return ContinueResult(timeline=timeline, execution=execution)
