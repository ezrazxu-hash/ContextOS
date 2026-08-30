from uuid import uuid4
from dataclasses import replace
from typing import Any

from contextos.runtime.session.model import Session, SessionStatus, utc_now
from contextos.runtime.session.repository import InMemorySessionRepository


class SessionNotFound(Exception):
    pass


class SessionService:
    def __init__(self, repository: InMemorySessionRepository) -> None:
        self._repository = repository

    def create_session(
        self,
        agent_template_id: str,
        workspace_id: str | None = None,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
        agent_version_id: str | None = None,
    ) -> Session:
        session = Session(
            id=f"session_{uuid4().hex}",
            workspace_id=workspace_id,
            agent_template_id=agent_template_id,
            current_timeline_id=None,
            created_at=utc_now(),
            status=SessionStatus.ACTIVE,
            title=title,
            metadata=metadata or {},
            agent_version_id=agent_version_id,
        )
        return self._repository.save(session)

    def get_session(self, session_id: str) -> Session:
        session = self._repository.get(session_id)
        if session is None:
            raise SessionNotFound(session_id)
        return session

    def remove_session(self, session_id: str) -> Session:
        session = self._repository.remove(session_id)
        if session is None:
            raise SessionNotFound(session_id)
        return session

    def list_sessions(self) -> list[Session]:
        return self._repository.list()

    def update_session_metadata(
        self,
        session_id: str,
        *,
        title: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Session:
        session = self.get_session(session_id)
        updated = replace(
            session,
            title=title if title is not None else session.title,
            metadata=metadata if metadata is not None else session.metadata,
        )
        return self._repository.save(updated)

    def update_session_agent_version(self, session_id: str, agent_version_id: str | None) -> Session:
        session = self.get_session(session_id)
        return self._repository.save(replace(session, agent_version_id=agent_version_id))
