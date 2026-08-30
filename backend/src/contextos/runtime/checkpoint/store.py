from contextos.runtime.checkpoint.model import Checkpoint
from contextos.runtime.persistence.json_store import JsonRuntimeStore
from datetime import datetime


class InMemoryCheckpointStore:
    def __init__(self, store: JsonRuntimeStore | None = None) -> None:
        self._store = store
        self._checkpoints: dict[str, Checkpoint] = {}

    def save(self, checkpoint: Checkpoint) -> Checkpoint:
        if self._store is not None:
            self._store.save_record("checkpoints", checkpoint.id, checkpoint_to_dict(checkpoint))
        else:
            self._checkpoints[checkpoint.id] = checkpoint
        return checkpoint

    def get(self, checkpoint_id: str) -> Checkpoint | None:
        if self._store is not None:
            record = self._store.get_record("checkpoints", checkpoint_id)
            return checkpoint_from_dict(record) if record is not None else None
        return self._checkpoints.get(checkpoint_id)

    def list_by_timeline(self, timeline_id: str) -> list[Checkpoint]:
        if self._store is not None:
            return sorted(
                [checkpoint_from_dict(record) for record in self._store.list_records("checkpoints") if record.get("timeline_id") == timeline_id],
                key=lambda checkpoint: checkpoint.created_at,
            )
        return [checkpoint for checkpoint in self._checkpoints.values() if checkpoint.timeline_id == timeline_id]

    def remove_by_session(self, session_id: str) -> int:
        if self._store is not None:
            return self._store.remove_records_where("checkpoints", lambda record: record.get("session_id") == session_id)
        removed_ids = [checkpoint_id for checkpoint_id, checkpoint in self._checkpoints.items() if checkpoint.session_id == session_id]
        for checkpoint_id in removed_ids:
            self._checkpoints.pop(checkpoint_id, None)
        return len(removed_ids)


def checkpoint_to_dict(checkpoint: Checkpoint) -> dict[str, object]:
    return {
        "id": checkpoint.id,
        "session_id": checkpoint.session_id,
        "timeline_id": checkpoint.timeline_id,
        "graph_state": checkpoint.graph_state,
        "message_cursor": checkpoint.message_cursor,
        "context_revision": checkpoint.context_revision,
        "created_at": checkpoint.created_at.isoformat(),
        "parent_checkpoint_id": checkpoint.parent_checkpoint_id,
        "agent_template_id": checkpoint.agent_template_id,
        "agent_version_id": checkpoint.agent_version_id,
    }


def checkpoint_from_dict(record: dict[str, object]) -> Checkpoint:
    return Checkpoint(
        id=str(record["id"]),
        session_id=str(record["session_id"]),
        timeline_id=str(record["timeline_id"]),
        graph_state=dict(record.get("graph_state", {})),
        message_cursor=int(record.get("message_cursor", 0)),
        context_revision=str(record.get("context_revision", "")),
        created_at=datetime.fromisoformat(str(record["created_at"])),
        parent_checkpoint_id=str(record["parent_checkpoint_id"]) if record.get("parent_checkpoint_id") is not None else None,
        agent_template_id=str(record["agent_template_id"]) if record.get("agent_template_id") is not None else None,
        agent_version_id=str(record["agent_version_id"]) if record.get("agent_version_id") is not None else None,
    )
