from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.workflow_v2.domain.definitions import create_workflow_v2_definition

COLLECTION = "workflow_v2_definitions"


class WorkflowV2DefinitionNotFound(Exception):
    pass


class RevisionConflictError(Exception):
    pass


class WorkflowV2PublishValidationError(Exception):
    def __init__(self, workflow_id: str, validation: dict[str, Any]) -> None:
        super().__init__(workflow_id)
        self.workflow_id = workflow_id
        self.validation = deepcopy(validation)


class WorkflowV2PublishedVersionNotFound(Exception):
    pass


@dataclass(frozen=True)
class WorkflowV2DefinitionRecord:
    workflow_id: str
    draft: dict[str, Any]
    revision: int
    updated_at: str
    versions: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.workflow_id,
            "draft": deepcopy(self.draft),
            "revision": self.revision,
            "updated_at": self.updated_at,
            "versions": deepcopy(self.versions),
        }


class WorkflowV2DefinitionService:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._records: dict[str, WorkflowV2DefinitionRecord] = {}

    def create(self, payload: dict[str, object]) -> dict[str, Any]:
        definition = create_workflow_v2_definition(payload)
        record = WorkflowV2DefinitionRecord(
            workflow_id=str(definition["id"]),
            draft={**definition, "revision": 1},
            revision=1,
            updated_at=_now(),
            versions=[],
        )
        self._save_record(record)
        return deepcopy(record.draft)

    def get(self, workflow_id: str) -> dict[str, Any]:
        record = self._get_record(workflow_id)
        if record is None:
            raise WorkflowV2DefinitionNotFound(workflow_id)
        return deepcopy(record.draft)

    def save_draft(self, workflow_id: str, payload: dict[str, object], *, expected_revision: int) -> dict[str, Any]:
        current = self._get_record(workflow_id)
        if current is None:
            raise WorkflowV2DefinitionNotFound(workflow_id)
        if current.revision != expected_revision:
            raise RevisionConflictError(workflow_id)

        definition = create_workflow_v2_definition({**payload, "id": workflow_id})
        next_revision = current.revision + 1
        record = WorkflowV2DefinitionRecord(
            workflow_id=workflow_id,
            draft={**definition, "revision": next_revision},
            revision=next_revision,
            updated_at=_now(),
            versions=deepcopy(current.versions),
        )
        self._save_record(record)
        return deepcopy(record.draft)

    def publish(self, workflow_id: str, *, validator) -> dict[str, Any]:
        current = self._get_record(workflow_id)
        if current is None:
            raise WorkflowV2DefinitionNotFound(workflow_id)

        validation = validator.validate(current.draft)
        if not validation["valid"]:
            raise WorkflowV2PublishValidationError(workflow_id, validation)

        version = len(current.versions) + 1
        published = {
            "workflowId": workflow_id,
            "version": version,
            "draftRevision": current.revision,
            "publishedAt": _now(),
            "definition": {**deepcopy(current.draft), "version": version},
        }
        record = WorkflowV2DefinitionRecord(
            workflow_id=workflow_id,
            draft=deepcopy(current.draft),
            revision=current.revision,
            updated_at=_now(),
            versions=[*deepcopy(current.versions), published],
        )
        self._save_record(record)
        return deepcopy(published)

    def list_versions(self, workflow_id: str) -> list[dict[str, Any]]:
        current = self._get_record(workflow_id)
        if current is None:
            raise WorkflowV2DefinitionNotFound(workflow_id)
        return deepcopy(current.versions)

    def get_version(self, workflow_id: str, version: int) -> dict[str, Any]:
        for published in self.list_versions(workflow_id):
            if int(published["version"]) == int(version):
                return deepcopy(published)
        raise WorkflowV2PublishedVersionNotFound(f"{workflow_id}@{version}")

    def _save_record(self, record: WorkflowV2DefinitionRecord) -> None:
        if self._store is not None:
            self._store.save_record(COLLECTION, record.workflow_id, record.to_dict())
        else:
            self._records[record.workflow_id] = record

    def _get_record(self, workflow_id: str) -> WorkflowV2DefinitionRecord | None:
        if self._store is not None:
            record = self._store.get_record(COLLECTION, workflow_id)
            return self._record_from_dict(record) if record is not None else None
        return self._records.get(workflow_id)

    @staticmethod
    def _record_from_dict(record: dict[str, Any]) -> WorkflowV2DefinitionRecord:
        return WorkflowV2DefinitionRecord(
            workflow_id=str(record["id"]),
            draft=deepcopy(record["draft"]),
            revision=int(record["revision"]),
            updated_at=str(record["updated_at"]),
            versions=deepcopy(record.get("versions", [])),
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
