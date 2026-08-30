from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from typing import Any

from contextos.template.version.model import AgentVersion, AgentVersionStatus
from contextos.template.version.repository import InMemoryAgentVersionRepository


class AgentVersionNotFound(Exception):
    pass


class AgentVersionImmutableError(Exception):
    pass


class AgentVersionService:
    def __init__(self, repository: InMemoryAgentVersionRepository) -> None:
        self._repository = repository

    def create_published_version(self, agent_template_id: str, manifest_payload: dict[str, Any]) -> AgentVersion:
        next_version = self._next_version(agent_template_id)
        version = AgentVersion(
            id=f"{agent_template_id}_v{next_version}",
            agent_template_id=agent_template_id,
            version=next_version,
            manifest_payload=deepcopy(manifest_payload),
            checksum=stable_manifest_checksum(manifest_payload),
            status=AgentVersionStatus.PUBLISHED,
            published_at=datetime.now(timezone.utc),
        )
        return self._repository.save_new(version)

    def get_version(self, version_id: str) -> AgentVersion:
        version = self._repository.get(version_id)
        if version is None:
            raise AgentVersionNotFound(version_id)
        return version

    def list_versions(self, agent_template_id: str) -> list[AgentVersion]:
        return self._repository.list_by_agent(agent_template_id)

    def update_version_manifest(self, version_id: str, manifest_payload: dict[str, Any]) -> AgentVersion:
        del manifest_payload
        version = self.get_version(version_id)
        if version.status is AgentVersionStatus.PUBLISHED:
            raise AgentVersionImmutableError(version_id)
        return version

    def _next_version(self, agent_template_id: str) -> int:
        versions = self._repository.list_by_agent(agent_template_id)
        if not versions:
            return 1
        return versions[-1].version + 1


def stable_manifest_checksum(manifest_payload: dict[str, Any]) -> str:
    encoded = json.dumps(manifest_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256(encoded).hexdigest()
