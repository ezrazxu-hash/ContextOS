from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.template.version.model import AgentVersion, AgentVersionStatus


class AgentVersionAlreadyExists(Exception):
    pass


class InMemoryAgentVersionRepository:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._versions: dict[str, AgentVersion] = {}

    def save_new(self, version: AgentVersion) -> AgentVersion:
        if self.get(version.id) is not None:
            raise AgentVersionAlreadyExists(version.id)
        if self._store is not None:
            self._store.save_record("agent_versions", version.id, version.to_dict())
        else:
            self._versions[version.id] = version
        return self.get(version.id) or version

    def get(self, version_id: str) -> AgentVersion | None:
        if self._store is not None:
            record = self._store.get_record("agent_versions", version_id)
            return _version_from_dict(record) if record is not None else None
        version = self._versions.get(version_id)
        return _clone_version(version) if version is not None else None

    def list_by_agent(self, agent_template_id: str) -> list[AgentVersion]:
        if self._store is not None:
            versions = [_version_from_dict(record) for record in self._store.list_records("agent_versions")]
        else:
            versions = [_clone_version(version) for version in self._versions.values()]
        return sorted(
            [version for version in versions if version.agent_template_id == agent_template_id],
            key=lambda version: version.version,
        )


def _clone_version(version: AgentVersion) -> AgentVersion:
    return AgentVersion(
        id=version.id,
        agent_template_id=version.agent_template_id,
        version=version.version,
        manifest_payload=deepcopy(version.manifest_payload),
        checksum=version.checksum,
        status=version.status,
        published_at=version.published_at,
    )


def _version_from_dict(record: dict[str, Any]) -> AgentVersion:
    return AgentVersion(
        id=str(record["id"]),
        agent_template_id=str(record["agent_template_id"]),
        version=int(record["version"]),
        manifest_payload=deepcopy(record["manifest"]),
        checksum=str(record["checksum"]),
        status=AgentVersionStatus(str(record["status"])),
        published_at=datetime.fromisoformat(str(record["published_at"])),
    )
