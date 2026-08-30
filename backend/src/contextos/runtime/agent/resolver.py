from __future__ import annotations

from collections.abc import Callable
from typing import Any

from contextos.runtime.session.model import Session


class AgentRuntimeResolutionError(Exception):
    def __init__(self, code: str, message: str, *, agent_version_id: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.agent_version_id = agent_version_id


class AgentRuntimeResolver:
    def __init__(
        self,
        *,
        legacy_runtime: object,
        workflow_runtime: object | None = None,
        workflow_enabled: bool = False,
        agent_version_loader: Callable[[str], object | None] | None = None,
    ) -> None:
        self._legacy_runtime = legacy_runtime
        self._workflow_runtime = workflow_runtime
        self._workflow_enabled = workflow_enabled
        self._agent_version_loader = agent_version_loader

    def resolve(self, session: Session) -> object:
        agent_version_id = _agent_version_id(session)
        if agent_version_id is None or not self._workflow_enabled:
            return self._legacy_runtime

        version = self._load_agent_version(agent_version_id)
        if version is None:
            raise AgentRuntimeResolutionError(
                "agent_version.not_found",
                f"AgentVersion not found: {agent_version_id}",
                agent_version_id=agent_version_id,
            )
        if _version_status(version) != "published":
            raise AgentRuntimeResolutionError(
                "agent_version.not_published",
                f"AgentVersion is not published: {agent_version_id}",
                agent_version_id=agent_version_id,
            )
        if self._workflow_runtime is None:
            raise AgentRuntimeResolutionError(
                "workflow_runtime.unavailable",
                "Workflow runtime is not configured",
                agent_version_id=agent_version_id,
            )
        return self._workflow_runtime

    def _load_agent_version(self, agent_version_id: str) -> object | None:
        if self._agent_version_loader is None:
            return None
        return self._agent_version_loader(agent_version_id)


def _agent_version_id(session: Session) -> str | None:
    direct_value = getattr(session, "agent_version_id", None)
    if direct_value:
        return str(direct_value)
    metadata_value = session.metadata.get("agent_version_id")
    return str(metadata_value) if metadata_value else None


def _version_status(version: object) -> str | None:
    if isinstance(version, dict):
        status = version.get("status")
    else:
        status = getattr(version, "status", None)
    if status is None:
        return None
    value = getattr(status, "value", status)
    return str(value).lower()
