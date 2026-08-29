from __future__ import annotations

from contextos.runtime.conversation.model import ConversationGroupState
from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
from contextos.runtime.session.message import MessageRole
from contextos.runtime.session.message_service import MessageNotFound, MessageService
from contextos.provider.base.token_counter import count_text_tokens


class ConversationContextBuilder:
    def __init__(self, group_repository: InMemoryConversationGroupRepository, message_service: MessageService) -> None:
        self._group_repository = group_repository
        self._message_service = message_service

    def build_llm_messages(self, session_id: str, timeline_id: str) -> list[dict[str, str]]:
        provider_messages: list[dict[str, str]] = []
        for group in self._group_repository.list_by_timeline(session_id, timeline_id):
            if group.state is not ConversationGroupState.ACTIVE:
                continue
            for message_id in group.message_ids:
                try:
                    message = self._message_service.get_message(message_id)
                except MessageNotFound:
                    continue
                if message.is_deleted:
                    continue
                if message.role not in (MessageRole.USER, MessageRole.ASSISTANT):
                    continue
                if not message.content:
                    continue
                provider_messages.append({"role": message.role.value, "content": message.content})
        return provider_messages

    def build_context_items(self, session_id: str, timeline_id: str) -> list[dict[str, object]]:
        items: list[dict[str, object]] = []
        for group in self._group_repository.list_by_timeline(session_id, timeline_id):
            if group.state is not ConversationGroupState.ACTIVE:
                continue
            messages = []
            for message_id in group.message_ids:
                try:
                    message = self._message_service.get_message(message_id)
                except MessageNotFound:
                    continue
                if message.is_deleted:
                    continue
                messages.append(message)
            if not messages:
                continue
            content = "\n".join(f"{message.role.value.title()}: {message.content}" for message in messages if message.content)
            items.append({
                "id": group.id,
                "session_id": group.session_id,
                "timeline_id": group.timeline_id,
                "group_id": group.id,
                "type": "MESSAGE_GROUP",
                "state": group.state.value,
                "raw_content": content,
                "generated_content": group.summary,
                "user_override": None,
                "effective_content": group.summary or content,
                "source_ids": [message.id for message in messages],
                "token_count_raw": count_text_tokens(content),
                "token_count_effective": count_text_tokens(group.summary or content),
                "priority": 0,
                "restorable": True,
            })
        return items
