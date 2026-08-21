from dataclasses import replace
from uuid import uuid4

from contextos.runtime.session.repository import InMemorySessionRepository
from contextos.runtime.timeline.model import Timeline, TimelineStatus, utc_now
from contextos.runtime.timeline.repository import InMemoryTimelineRepository


class TimelineNotFound(Exception):
    pass


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
        self._point_session_to_timeline(timeline.session_id, timeline.id)
        return timeline

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

    def _point_session_to_timeline(self, session_id: str, timeline_id: str) -> None:
        session = self._session_repository.get(session_id)
        if session is not None:
            self._session_repository.save(replace(session, current_timeline_id=timeline_id))

