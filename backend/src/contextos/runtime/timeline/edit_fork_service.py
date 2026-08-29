from dataclasses import dataclass
from uuid import uuid4

from contextos.runtime.conversation.model import ConversationGroup, ConversationGroupState
from contextos.runtime.conversation.service import ConversationGroupService
from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.session.message import SessionMessage
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
        conversation_group_service: ConversationGroupService | None = None,
    ) -> None:
        self._timeline_service = timeline_service
        self._message_service = message_service
        self._revision_service = revision_service
        self._conversation_group_service = conversation_group_service

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
        if self._conversation_group_service is not None:
            working_context_messages = fork_timeline_context(
                parent_timeline_id=parent_timeline_id,
                child_timeline_id=timeline.id,
                edited_message=message,
                edited_content=revision.new_content,
                message_service=self._message_service,
                conversation_group_service=self._conversation_group_service,
                include_edited_message=True,
                revision_id=revision.id,
            )
        else:
            working_context_messages = self._working_context(message.session_id, message.cursor, message.id, revision.new_content)
        return ContextOnlyEditResult(
            timeline=timeline,
            working_context_messages=working_context_messages,
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


def fork_timeline_context(
    *,
    parent_timeline_id: str,
    child_timeline_id: str,
    edited_message: SessionMessage,
    edited_content: str | None,
    message_service: MessageService,
    conversation_group_service: ConversationGroupService,
    include_edited_message: bool,
    revision_id: str | None = None,
) -> list[dict[str, str]]:
    groups = conversation_group_service.list_groups(edited_message.session_id, parent_timeline_id)
    target_group = _target_group(groups, edited_message)
    if target_group is None:
        return []

    copied_messages: list[SessionMessage] = []
    for group in groups:
        if group.state is not ConversationGroupState.ACTIVE:
            continue
        if group.cursor < target_group.cursor:
            copied_messages.extend(_copy_group(group, child_timeline_id, message_service, conversation_group_service))
            continue
        if group.id == target_group.id and include_edited_message:
            copied_messages.extend(_copy_group(
                group,
                child_timeline_id,
                message_service,
                conversation_group_service,
                max_cursor=edited_message.cursor,
                replacement_message_id=edited_message.id,
                replacement_content=edited_content,
                revision_id=revision_id,
            ))
        break
    return [{"message_id": message.id, "content": message.content} for message in copied_messages]


def _target_group(groups: list[ConversationGroup], message: SessionMessage) -> ConversationGroup | None:
    for group in groups:
        if group.id == message.group_id or message.id in group.message_ids:
            return group
    return None


def _copy_group(
    group: ConversationGroup,
    child_timeline_id: str,
    message_service: MessageService,
    conversation_group_service: ConversationGroupService,
    *,
    max_cursor: int | None = None,
    replacement_message_id: str | None = None,
    replacement_content: str | None = None,
    revision_id: str | None = None,
) -> list[SessionMessage]:
    child_group_id = f"group_{uuid4().hex}"
    copied_messages: list[SessionMessage] = []
    for message_id in group.message_ids:
        message = message_service.get_message(message_id)
        if message.is_deleted or (max_cursor is not None and message.cursor > max_cursor):
            continue
        copied_messages.append(
            message_service.copy_message_to_timeline(
                message,
                child_timeline_id,
                content=replacement_content if message.id == replacement_message_id else None,
                group_id=child_group_id,
                context_group_ids=[child_group_id],
                revision_id=revision_id if message.id == replacement_message_id else None,
            )
        )
    if copied_messages:
        conversation_group_service.create_group(
            group.session_id,
            child_timeline_id,
            [message.id for message in copied_messages],
            state=group.state,
            summary=group.summary,
            group_id=child_group_id,
        )
    return copied_messages
