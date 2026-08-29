from contextos.runtime.timeline.model import Timeline
from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.runtime.timeline.model import TimelineStatus
from datetime import datetime


class InMemoryTimelineRepository:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._timelines: dict[str, Timeline] = {}

    def save(self, timeline: Timeline) -> Timeline:
        if self._store is not None:
            self._store.save_record("timelines", timeline.id, timeline.to_dict())
        else:
            self._timelines[timeline.id] = timeline
        return timeline

    def get(self, timeline_id: str) -> Timeline | None:
        if self._store is not None:
            record = self._store.get_record("timelines", timeline_id)
            return _timeline_from_dict(record) if record is not None else None
        return self._timelines.get(timeline_id)

    def list_by_session(self, session_id: str) -> list[Timeline]:
        if self._store is not None:
            timelines = sorted(
                [_timeline_from_dict(record) for record in self._store.list_records("timelines") if record.get("session_id") == session_id],
                key=lambda timeline: timeline.created_at,
            )
        else:
            timelines = [timeline for timeline in self._timelines.values() if timeline.session_id == session_id]
        return [timeline for timeline in timelines if timeline.status is not TimelineStatus.DELETED]

    def remove_by_session(self, session_id: str) -> int:
        if self._store is not None:
            return self._store.remove_records_where("timelines", lambda record: record.get("session_id") == session_id)
        removed_ids = [timeline_id for timeline_id, timeline in self._timelines.items() if timeline.session_id == session_id]
        for timeline_id in removed_ids:
            self._timelines.pop(timeline_id, None)
        return len(removed_ids)


def _timeline_from_dict(record: dict[str, object]) -> Timeline:
    return Timeline(
        id=str(record["id"]),
        session_id=str(record["session_id"]),
        parent_timeline_id=str(record["parent_timeline_id"]) if record.get("parent_timeline_id") is not None else None,
        fork_checkpoint_id=str(record["fork_checkpoint_id"]) if record.get("fork_checkpoint_id") is not None else None,
        fork_message_id=str(record["fork_message_id"]) if record.get("fork_message_id") is not None else None,
        created_at=datetime.fromisoformat(str(record["created_at"])),
        status=TimelineStatus(str(record["status"])),
    )
