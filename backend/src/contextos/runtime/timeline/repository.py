from contextos.runtime.timeline.model import Timeline


class InMemoryTimelineRepository:
    def __init__(self) -> None:
        self._timelines: dict[str, Timeline] = {}

    def save(self, timeline: Timeline) -> Timeline:
        self._timelines[timeline.id] = timeline
        return timeline

    def get(self, timeline_id: str) -> Timeline | None:
        return self._timelines.get(timeline_id)

    def list_by_session(self, session_id: str) -> list[Timeline]:
        return [timeline for timeline in self._timelines.values() if timeline.session_id == session_id]

