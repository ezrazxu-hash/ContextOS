from dataclasses import dataclass

from contextos.context.group.model import ContextGroup, ContextGroupType
from contextos.context.model.enums import ContextItemState


@dataclass(frozen=True)
class ContextSearchQuery:
    keyword: str | None = None
    group_type: ContextGroupType | None = None
    state: ContextItemState | None = None
    timeline_id: str | None = None


@dataclass(frozen=True)
class ContextSearchResult:
    group_id: str
    summary: str | None
    state: str
    token_count: int
    restorable: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "group_id": self.group_id,
            "summary": self.summary,
            "state": self.state,
            "token_count": self.token_count,
            "restorable": self.restorable,
        }


def search_context_groups(groups: list[ContextGroup], query: ContextSearchQuery) -> list[ContextSearchResult]:
    return [_to_result(group) for group in groups if _matches(group, query)]


def _matches(group: ContextGroup, query: ContextSearchQuery) -> bool:
    if query.timeline_id is not None and group.timeline_id != query.timeline_id:
        return False
    if query.group_type is not None and group.group_type != query.group_type:
        return False
    if query.state is not None and group.state != query.state:
        return False
    if query.keyword is not None and not _matches_keyword(group, query.keyword):
        return False
    return True


def _matches_keyword(group: ContextGroup, keyword: str) -> bool:
    haystack = " ".join([group.id, group.summary or "", group.placeholder or ""]).lower()
    terms = [term for term in keyword.lower().split() if term]
    return all(term in haystack for term in terms)


def _to_result(group: ContextGroup) -> ContextSearchResult:
    return ContextSearchResult(
        group_id=group.id,
        summary=group.summary,
        state=group.state.value,
        token_count=group.effective_token_count,
        restorable=group.restorable,
    )
