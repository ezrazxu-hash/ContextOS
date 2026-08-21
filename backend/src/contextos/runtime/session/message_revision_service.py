from uuid import uuid4

from contextos.runtime.session.message import SessionMessage
from contextos.runtime.session.message_revision import MessageRevision, new_revision_timestamp


class MessageRevisionNotFound(Exception):
    pass


class MessageRevisionService:
    def __init__(self) -> None:
        self._revisions_by_message_id: dict[str, list[MessageRevision]] = {}

    def append_revision(
        self,
        message: SessionMessage,
        new_content: str,
        operator: str,
        reason: str,
        timeline_id: str | None = None,
        context_revision_id: str | None = None,
    ) -> MessageRevision:
        existing = self._revisions_by_message_id.get(message.id, [])
        previous = existing[-1] if existing else None
        revision = MessageRevision(
            id=f"message_revision_{uuid4().hex}",
            message_id=message.id,
            session_id=message.session_id,
            revision_number=len(existing) + 1,
            original_content=previous.original_content if previous else message.content,
            previous_content=previous.new_content if previous else message.content,
            new_content=new_content,
            operator=operator,
            reason=reason,
            timeline_id=timeline_id,
            context_revision_id=context_revision_id,
            previous_revision_id=previous.id if previous else None,
            created_at=new_revision_timestamp(),
        )
        self._revisions_by_message_id.setdefault(message.id, []).append(revision)
        return revision

    def list_revisions(self, message_id: str) -> list[MessageRevision]:
        return list(self._revisions_by_message_id.get(message_id, []))

    def current_content(self, message_id: str) -> str | None:
        revisions = self._revisions_by_message_id.get(message_id, [])
        if not revisions:
            return None
        return revisions[-1].new_content

    def get_revision(self, revision_id: str) -> MessageRevision:
        for revisions in self._revisions_by_message_id.values():
            for revision in revisions:
                if revision.id == revision_id:
                    return revision
        raise MessageRevisionNotFound(revision_id)
