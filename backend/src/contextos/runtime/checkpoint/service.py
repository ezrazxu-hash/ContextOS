from copy import deepcopy
from uuid import uuid4

from contextos.runtime.checkpoint.model import Checkpoint, utc_now
from contextos.runtime.checkpoint.store import InMemoryCheckpointStore


class CheckpointNotFound(Exception):
    pass


class CheckpointService:
    def __init__(self, store: InMemoryCheckpointStore) -> None:
        self._store = store

    def save_checkpoint(
        self,
        session_id: str,
        timeline_id: str,
        graph_state: dict[str, object],
        message_cursor: int,
        context_revision: str,
        parent_checkpoint_id: str | None = None,
        agent_template_id: str | None = None,
        agent_version_id: str | None = None,
    ) -> Checkpoint:
        checkpoint = Checkpoint(
            id=f"checkpoint_{uuid4().hex}",
            session_id=session_id,
            timeline_id=timeline_id,
            graph_state=deepcopy(graph_state),
            message_cursor=message_cursor,
            context_revision=context_revision,
            created_at=utc_now(),
            parent_checkpoint_id=parent_checkpoint_id,
            agent_template_id=agent_template_id,
            agent_version_id=agent_version_id,
        )
        return self._store.save(checkpoint)

    def restore_checkpoint(self, checkpoint_id: str) -> Checkpoint:
        checkpoint = self._store.get(checkpoint_id)
        if checkpoint is None:
            raise CheckpointNotFound(checkpoint_id)
        return Checkpoint(
            id=checkpoint.id,
            session_id=checkpoint.session_id,
            timeline_id=checkpoint.timeline_id,
            graph_state=deepcopy(checkpoint.graph_state),
            message_cursor=checkpoint.message_cursor,
            context_revision=checkpoint.context_revision,
            created_at=checkpoint.created_at,
            parent_checkpoint_id=checkpoint.parent_checkpoint_id,
            agent_template_id=checkpoint.agent_template_id,
            agent_version_id=checkpoint.agent_version_id,
        )

