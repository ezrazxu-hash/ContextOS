from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from uuid import uuid4

from contextos.runtime.conversation.model import ConversationGroup, ConversationGroupState
from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository


class ConversationGroupNotFound(Exception):
    pass


class ConversationGroupService:
    def __init__(self, repository: InMemoryConversationGroupRepository) -> None:
        self._repository = repository

    def start_turn(
        self,
        session_id: str,
        timeline_id: str,
        user_message_id: str,
        *,
        group_id: str | None = None,
    ) -> ConversationGroup:
        group = ConversationGroup(
            id=group_id or f"group_{uuid4().hex}",
            session_id=session_id,
            timeline_id=timeline_id,
            cursor=self._repository.next_cursor(session_id, timeline_id),
            state=ConversationGroupState.ACTIVE,
            message_ids=[user_message_id],
        )
        return self._repository.save(group)

    def append_message(self, group_id: str, message_id: str) -> ConversationGroup:
        group = self._require_group(group_id)
        if message_id in group.message_ids:
            return group
        return self._repository.save(replace(group, message_ids=[*group.message_ids, message_id], updated_at=_utc_now()))

    def set_state(self, group_id: str, state: ConversationGroupState) -> ConversationGroup:
        group = self._require_group(group_id)
        return self._repository.save(replace(group, state=state, updated_at=_utc_now()))

    def list_groups(self, session_id: str, timeline_id: str) -> list[ConversationGroup]:
        return self._repository.list_by_timeline(session_id, timeline_id)

    def latest_group(self, session_id: str, timeline_id: str) -> ConversationGroup | None:
        groups = self.list_groups(session_id, timeline_id)
        return groups[-1] if groups else None

    def _require_group(self, group_id: str) -> ConversationGroup:
        group = self._repository.get(group_id)
        if group is None:
            raise ConversationGroupNotFound(group_id)
        return group


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
