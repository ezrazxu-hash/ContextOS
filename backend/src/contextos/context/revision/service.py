from uuid import uuid4

from contextos.context.revision.model import ContextRevision, RevisionType, utc_now
from contextos.context.revision.repository import InMemoryContextRevisionRepository


class ContextRevisionService:
    def __init__(self, repository: InMemoryContextRevisionRepository) -> None:
        self._repository = repository

    def record_revision(
        self,
        context_item_id: str,
        revision_type: RevisionType,
        old_value: str | None,
        new_value: str | None,
        operator: str,
        reason: str,
    ) -> ContextRevision:
        revision = ContextRevision(
            id=f"context_revision_{uuid4().hex}",
            context_item_id=context_item_id,
            revision_type=revision_type,
            old_value=old_value,
            new_value=new_value,
            operator=operator,
            created_at=utc_now(),
            reason=reason,
        )
        return self._repository.append(revision)

    def list_revisions(self, context_item_id: str) -> list[ContextRevision]:
        return self._repository.list_by_item(context_item_id)

