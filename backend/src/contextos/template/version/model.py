from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any


class AgentVersionStatus(Enum):
    PUBLISHED = "published"


@dataclass(frozen=True)
class AgentVersion:
    id: str
    agent_template_id: str
    version: int
    manifest_payload: dict[str, Any]
    checksum: str
    status: AgentVersionStatus
    published_at: datetime

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "agent_template_id": self.agent_template_id,
            "version": self.version,
            "manifest": deepcopy(self.manifest_payload),
            "checksum": self.checksum,
            "status": self.status.value,
            "published_at": self.published_at.isoformat(),
        }
