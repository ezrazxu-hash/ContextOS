from contextos.context.revision.model import ContextRevision


class InMemoryContextRevisionRepository:
    def __init__(self) -> None:
        self._revisions: list[ContextRevision] = []

    def append(self, revision: ContextRevision) -> ContextRevision:
        self._revisions.append(revision)
        return revision

    def list_by_item(self, context_item_id: str) -> list[ContextRevision]:
        return [revision for revision in self._revisions if revision.context_item_id == context_item_id]

