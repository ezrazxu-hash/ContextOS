from uuid import uuid4

from contextos.runtime.session.model import Session, SessionStatus, utc_now
from contextos.runtime.session.repository import InMemorySessionRepository


class SessionNotFound(Exception):
    pass


class SessionService:
    def __init__(self, repository: InMemorySessionRepository) -> None:
        self._repository = repository

    def create_session(self, agent_template_id: str, workspace_id: str | None = None) -> Session:
        session = Session(
            id=f"session_{uuid4().hex}",
            workspace_id=workspace_id,
            agent_template_id=agent_template_id,
            current_timeline_id=None,
            created_at=utc_now(),
            status=SessionStatus.ACTIVE,
        )
        return self._repository.save(session)

    def get_session(self, session_id: str) -> Session:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFound(session_id)
        return session

    def list_sessions(self) -> list[Session]:
        return self._repository.list()
