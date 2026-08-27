from __future__ import annotations

from contextos.runtime.conversation.model import ConversationGroupState
from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
from contextos.runtime.session.message import MessageRole
from contextos.runtime.session.message_service import MessageNotFound, MessageService


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
                if message.role not in (MessageRole.USER, MessageRole.ASSISTANT):
                    continue
                if not message.content:
                    continue
                provider_messages.append({"role": message.role.value, "content": message.content})
        return provider_messages
