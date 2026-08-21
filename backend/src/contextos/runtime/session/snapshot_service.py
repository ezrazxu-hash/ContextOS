from contextos.runtime.checkpoint.model import Checkpoint
from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
from contextos.runtime.session.repository import InMemorySessionRepository
from contextos.runtime.timeline.repository import InMemoryTimelineRepository
from contextos.runtime.trace.repository import InMemoryTraceRepository


class SnapshotSessionNotFound(Exception):
    pass


class RuntimeSnapshotService:
    def __init__(
        self,
        session_repository: InMemorySessionRepository,
        timeline_repository: InMemoryTimelineRepository,
        checkpoint_store: InMemoryCheckpointStore,
        trace_repository: InMemoryTraceRepository,
    ) -> None:
        self._session_repository = session_repository
        self._timeline_repository = timeline_repository
        self._checkpoint_store = checkpoint_store
        self._trace_repository = trace_repository

    def rehydrate(self, session_id: str) -> dict[str, object]:
        session = self._session_repository.get(session_id)
        if session is None:
            raise SnapshotSessionNotFound(session_id)

        current_timeline = None
        latest_checkpoint = None
        if session.current_timeline_id is not None:
            current_timeline = self._timeline_repository.get(session.current_timeline_id)
            latest_checkpoint = self._latest_checkpoint(session.current_timeline_id)

        return {
            "session": session.to_dict(),
            "current_timeline": current_timeline.to_dict() if current_timeline is not None else None,
            "checkpoint": checkpoint_to_dict(latest_checkpoint) if latest_checkpoint is not None else None,
            "message_index": latest_checkpoint.message_cursor if latest_checkpoint is not None else None,
            "context_revision": latest_checkpoint.context_revision if latest_checkpoint is not None else None,
            "trace_summary": [
                {
                    "trace_id": event.trace_id,
                    "step_type": event.step_type,
                    "component": event.component,
                    "status": event.status,
                }
                for event in self._trace_repository.list_by_session(session_id)
            ],
        }

    def _latest_checkpoint(self, timeline_id: str) -> Checkpoint | None:
        checkpoints = self._checkpoint_store.list_by_timeline(timeline_id)
        if not checkpoints:
            return None
        return max(checkpoints, key=lambda checkpoint: checkpoint.created_at)


def checkpoint_to_dict(checkpoint: Checkpoint) -> dict[str, object]:
    return {
        "id": checkpoint.id,
        "session_id": checkpoint.session_id,
        "timeline_id": checkpoint.timeline_id,
        "message_cursor": checkpoint.message_cursor,
        "context_revision": checkpoint.context_revision,
        "created_at": checkpoint.created_at.isoformat(),
        "parent_checkpoint_id": checkpoint.parent_checkpoint_id,
    }

