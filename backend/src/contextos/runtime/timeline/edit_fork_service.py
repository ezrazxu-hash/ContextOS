from dataclasses import dataclass

from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.timeline.model import Timeline
from contextos.runtime.timeline.service import TimelineService


@dataclass(frozen=True)
class ContextOnlyEditResult:
    timeline: Timeline
    working_context_messages: list[dict[str, str]]


class EditForkService:
    def __init__(
        self,
        timeline_service: TimelineService,
        message_service: MessageService,
        revision_service: MessageRevisionService,
    ) -> None:
        self._timeline_service = timeline_service
        self._message_service = message_service
        self._revision_service = revision_service

    def apply_context_only_edit(
        self,
        parent_timeline_id: str,
        message_id: str,
        revision_id: str,
    ) -> ContextOnlyEditResult:
        message = self._message_service.get_message(message_id)
        revision = self._revision_service.get_revision(revision_id)
        timeline = self._timeline_service.fork_timeline(
            parent_timeline_id=parent_timeline_id,
            fork_checkpoint_id=message.checkpoint_id or "",
            fork_message_id=message.id,
        )
        self._timeline_service.activate_timeline(timeline.id)
        return ContextOnlyEditResult(
            timeline=timeline,
            working_context_messages=self._working_context(message.session_id, message.cursor, message.id, revision.new_content),
        )

    def _working_context(
        self,
        session_id: str,
        max_cursor: int,
        edited_message_id: str,
        edited_content: str,
    ) -> list[dict[str, str]]:
        messages, _ = self._message_service.list_messages(session_id)
        working_context = []
        for message in messages:
            if message.cursor > max_cursor:
                continue
            working_context.append(
                {
                    "message_id": message.id,
                    "content": edited_content if message.id == edited_message_id else message.content,
                }
            )
        return working_context
