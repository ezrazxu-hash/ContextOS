from contextos.runtime.session.model import Session
from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.runtime.session.model import SessionStatus
from datetime import datetime


class InMemorySessionRepository:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._sessions: dict[str, Session] = {}

    def save(self, session: Session) -> Session:
        if self._store is not None:
            self._store.save_record("sessions", session.id, session.to_dict())
        else:
            self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        if self._store is not None:
            record = self._store.get_record("sessions", session_id)
            return _session_from_dict(record) if record is not None else None
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> Session | None:
        if self._store is not None:
            record = self._store.remove_record("sessions", session_id)
            return _session_from_dict(record) if record is not None else None
        return self._sessions.pop(session_id, None)

    def list(self) -> list[Session]:
        if self._store is not None:
            sessions = [_session_from_dict(record) for record in self._store.list_records("sessions")]
        else:
            sessions = list(self._sessions.values())
        return sorted(sessions, key=lambda session: (session.created_at, session.id))


def _session_from_dict(record: dict[str, object]) -> Session:
    metadata = record.get("metadata")
    return Session(
        id=str(record["id"]),
        workspace_id=str(record["workspace_id"]) if record.get("workspace_id") is not None else None,
        agent_template_id=str(record["agent_template_id"]),
        current_timeline_id=str(record["current_timeline_id"]) if record.get("current_timeline_id") is not None else None,
        created_at=datetime.fromisoformat(str(record["created_at"])),
        status=SessionStatus(str(record["status"])),
        title=str(record["title"]) if record.get("title") is not None else None,
        metadata=dict(metadata) if isinstance(metadata, dict) else {},
    )
