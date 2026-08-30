from dataclasses import dataclass, replace
from uuid import uuid4

from contextos.runtime.session.repository import InMemorySessionRepository
from contextos.runtime.timeline.model import Timeline, TimelineStatus, utc_now
from contextos.runtime.timeline.repository import InMemoryTimelineRepository


class TimelineNotFound(Exception):
    pass


@dataclass(frozen=True)
class DeleteTimelineResult:
    timeline: Timeline
    current_timeline_id: str | None


class TimelineService:
    def __init__(self, repository: InMemoryTimelineRepository, session_repository: InMemorySessionRepository) -> None:
        self._repository = repository
        self._session_repository = session_repository

    def create_initial_timeline(self, session_id: str) -> Timeline:
        timeline = self._save_timeline(
            session_id=session_id,
            parent_timeline_id=None,
            fork_checkpoint_id=None,
            fork_message_id=None,
        )
        self._point_session_to_timeline(session_id, timeline.id)
        return timeline

    def fork_timeline(self, parent_timeline_id: str, fork_checkpoint_id: str, fork_message_id: str) -> Timeline:
        parent = self.get_timeline(parent_timeline_id)
        return self._save_timeline(
            session_id=parent.session_id,
            parent_timeline_id=parent.id,
            fork_checkpoint_id=fork_checkpoint_id,
            fork_message_id=fork_message_id,
        )

    def list_timelines(self, session_id: str) -> list[Timeline]:
        return self._repository.list_by_session(session_id)

    def get_timeline(self, timeline_id: str) -> Timeline:
        timeline = self._repository.get(timeline_id)
        if timeline is None:
            raise TimelineNotFound(timeline_id)
        return timeline

    def activate_timeline(self, timeline_id: str) -> Timeline:
        timeline = self.get_timeline(timeline_id)
        if timeline.status is TimelineStatus.DELETED:
            raise TimelineNotFound(timeline_id)
        self._point_session_to_timeline(timeline.session_id, timeline.id)
        return timeline

    def update_timeline_title(self, timeline_id: str, title: str) -> Timeline:
        timeline = self.get_timeline(timeline_id)
        if timeline.status is TimelineStatus.DELETED:
            raise TimelineNotFound(timeline_id)
        return self._repository.save(replace(timeline, title=title))

    def delete_timeline(self, timeline_id: str) -> DeleteTimelineResult:
        timeline = self.get_timeline(timeline_id)
        if timeline.status is TimelineStatus.DELETED:
            raise TimelineNotFound(timeline_id)

        active_timelines = self.list_timelines(timeline.session_id)
        replacement = _replacement_timeline(active_timelines, timeline.id)
        deleted = self._repository.save(replace(timeline, status=TimelineStatus.DELETED))

        session = self._session_repository.get(timeline.session_id)
        current_timeline_id = session.current_timeline_id if session is not None else None
        if current_timeline_id == timeline.id:
            current_timeline_id = replacement.id if replacement is not None else None
            self._point_session_to_timeline(timeline.session_id, current_timeline_id)

        return DeleteTimelineResult(timeline=deleted, current_timeline_id=current_timeline_id)

    def _save_timeline(
        self,
        session_id: str,
        parent_timeline_id: str | None,
        fork_checkpoint_id: str | None,
        fork_message_id: str | None,
    ) -> Timeline:
        timeline = Timeline(
            id=f"timeline_{uuid4().hex}",
            session_id=session_id,
            parent_timeline_id=parent_timeline_id,
            fork_checkpoint_id=fork_checkpoint_id,
            fork_message_id=fork_message_id,
            created_at=utc_now(),
            status=TimelineStatus.ACTIVE,
        )
        return self._repository.save(timeline)

    def _point_session_to_timeline(self, session_id: str, timeline_id: str | None) -> None:
        session = self._session_repository.get(session_id)
        if session is not None:
            self._session_repository.save(replace(session, current_timeline_id=timeline_id))


def _replacement_timeline(timelines: list[Timeline], deleted_timeline_id: str) -> Timeline | None:
    remaining = [timeline for timeline in timelines if timeline.id != deleted_timeline_id]
    if not remaining:
        return None
    deleted_index = next((index for index, timeline in enumerate(timelines) if timeline.id == deleted_timeline_id), 0)
    return remaining[min(deleted_index, len(remaining) - 1)]

