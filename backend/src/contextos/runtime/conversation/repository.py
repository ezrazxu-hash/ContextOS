from __future__ import annotations

from datetime import datetime

from contextos.runtime.conversation.model import ConversationGroup, ConversationGroupState
from contextos.runtime.persistence.json_store import JsonRuntimeStore


class InMemoryConversationGroupRepository:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._groups: dict[str, ConversationGroup] = {}

    def save(self, group: ConversationGroup) -> ConversationGroup:
        if self._store is not None:
            self._store.save_record("conversation_groups", group.id, group.to_dict())
        else:
            self._groups[group.id] = group
        return group

    def get(self, group_id: str) -> ConversationGroup | None:
        if self._store is not None:
            record = self._store.get_record("conversation_groups", group_id)
            return _group_from_dict(record) if record is not None else None
        return self._groups.get(group_id)

    def list_by_timeline(self, session_id: str, timeline_id: str) -> list[ConversationGroup]:
        if self._store is not None:
            groups = [
                _group_from_dict(record)
                for record in self._store.list_records("conversation_groups")
                if record.get("session_id") == session_id and record.get("timeline_id") == timeline_id
            ]
        else:
            groups = [group for group in self._groups.values() if group.session_id == session_id and group.timeline_id == timeline_id]
        return sorted(groups, key=lambda group: group.cursor)

    def remove_by_session(self, session_id: str) -> int:
        if self._store is not None:
            return self._store.remove_records_where("conversation_groups", lambda record: record.get("session_id") == session_id)
        removed_ids = [group_id for group_id, group in self._groups.items() if group.session_id == session_id]
        for group_id in removed_ids:
            self._groups.pop(group_id, None)
        return len(removed_ids)

    def next_cursor(self, session_id: str, timeline_id: str) -> int:
        groups = self.list_by_timeline(session_id, timeline_id)
        return (groups[-1].cursor + 1) if groups else 1


def _group_from_dict(record: dict[str, object]) -> ConversationGroup:
    return ConversationGroup(
        id=str(record["id"]),
        session_id=str(record["session_id"]),
        timeline_id=str(record["timeline_id"]),
        cursor=int(record["cursor"]),
        state=ConversationGroupState(str(record["state"])),
        message_ids=[str(item) for item in record.get("message_ids", [])],
        summary=str(record["summary"]) if record.get("summary") is not None else None,
        created_at=datetime.fromisoformat(str(record["created_at"])),
        updated_at=datetime.fromisoformat(str(record["updated_at"])),
    )
