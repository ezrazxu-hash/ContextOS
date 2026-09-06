from __future__ import annotations

import base64
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from contextos.runtime.persistence.json_store import JsonRuntimeStore

COLLECTION = "workflow_v2_artifacts"


class WorkflowV2ArtifactNotFound(Exception):
    pass


@dataclass(frozen=True)
class WorkflowV2ArtifactContent:
    id: str
    run_id: str
    name: str
    mime_type: str
    content: bytes
    created_by_node_id: str
    visible: bool
    created_at: str
    metadata: dict[str, Any]

    def ref(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "mimeType": self.mime_type,
            "createdByNodeId": self.created_by_node_id,
            "visible": self.visible,
        }

    def content_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "runId": self.run_id,
            "name": self.name,
            "mimeType": self.mime_type,
            "content": self.content,
            "createdByNodeId": self.created_by_node_id,
            "visible": self.visible,
            "createdAt": self.created_at,
            "metadata": deepcopy(self.metadata),
        }


class InMemoryWorkflowV2ArtifactStore:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._artifacts: dict[str, WorkflowV2ArtifactContent] = {}
        self._run_index: dict[str, list[str]] = {}
        if self._store is not None:
            for item in self._store.list_records(COLLECTION):
                record = _artifact_from_dict(item)
                self._artifacts[record.id] = record
                self._run_index.setdefault(record.run_id, []).append(record.id)

    def save(self, *, run_id: str, created_by_node_id: str, artifact: dict[str, Any]) -> dict[str, Any]:
        content = _artifact_content(artifact.get("content", b""))
        record = WorkflowV2ArtifactContent(
            id=f"artifact_{uuid4().hex}",
            run_id=run_id,
            name=str(artifact.get("name") or "artifact"),
            mime_type=str(artifact.get("mimeType", artifact.get("mime_type", "application/octet-stream"))),
            content=content,
            created_by_node_id=created_by_node_id,
            visible=artifact.get("visible") is not False,
            created_at=datetime.now(timezone.utc).isoformat(),
            metadata=deepcopy(artifact.get("metadata")) if isinstance(artifact.get("metadata"), dict) else {},
        )
        self._artifacts[record.id] = record
        self._run_index.setdefault(run_id, []).append(record.id)
        if self._store is not None:
            self._store.save_record(COLLECTION, record.id, _artifact_to_dict(record))
        return record.ref()

    def list_by_run(self, run_id: str) -> list[dict[str, Any]]:
        return [self._artifacts[artifact_id].ref() for artifact_id in self._run_index.get(run_id, []) if artifact_id in self._artifacts]

    def get_content(self, artifact_id: str) -> dict[str, Any]:
        if artifact_id not in self._artifacts:
            raise WorkflowV2ArtifactNotFound(artifact_id)
        return self._artifacts[artifact_id].content_dict()


def _artifact_content(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        return value.encode("utf-8")
    return b""


def _artifact_to_dict(record: WorkflowV2ArtifactContent) -> dict[str, Any]:
    return {
        "id": record.id,
        "runId": record.run_id,
        "name": record.name,
        "mimeType": record.mime_type,
        "contentBase64": base64.b64encode(record.content).decode("ascii"),
        "createdByNodeId": record.created_by_node_id,
        "visible": record.visible,
        "createdAt": record.created_at,
        "metadata": deepcopy(record.metadata),
    }


def _artifact_from_dict(record: dict[str, Any]) -> WorkflowV2ArtifactContent:
    return WorkflowV2ArtifactContent(
        id=str(record["id"]),
        run_id=str(record["runId"]),
        name=str(record["name"]),
        mime_type=str(record["mimeType"]),
        content=base64.b64decode(str(record.get("contentBase64", ""))),
        created_by_node_id=str(record["createdByNodeId"]),
        visible=record.get("visible") is not False,
        created_at=str(record["createdAt"]),
        metadata=deepcopy(record.get("metadata")) if isinstance(record.get("metadata"), dict) else {},
    )
