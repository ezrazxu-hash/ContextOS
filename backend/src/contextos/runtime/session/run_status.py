from __future__ import annotations


BUSY_SESSION_RUN_STATUSES = {"generating", "unfinished_tool", "interrupt", "replay"}


class SessionRunStatusService:
    def __init__(self) -> None:
        self._status_by_session: dict[str, str] = {}

    def set_status(self, session_id: str, status: str) -> None:
        self._status_by_session[session_id] = status

    def get_status(self, session_id: str) -> str:
        return self._status_by_session.get(session_id, "idle")

    def is_busy(self, session_id: str) -> bool:
        return self.get_status(session_id) in BUSY_SESSION_RUN_STATUSES
