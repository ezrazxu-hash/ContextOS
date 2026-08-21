from contextos.runtime.checkpoint.model import Checkpoint


class InMemoryCheckpointStore:
    def __init__(self) -> None:
        self._checkpoints: dict[str, Checkpoint] = {}

    def save(self, checkpoint: Checkpoint) -> Checkpoint:
        self._checkpoints[checkpoint.id] = checkpoint
        return checkpoint

    def get(self, checkpoint_id: str) -> Checkpoint | None:
        return self._checkpoints.get(checkpoint_id)

    def list_by_timeline(self, timeline_id: str) -> list[Checkpoint]:
        return [checkpoint for checkpoint in self._checkpoints.values() if checkpoint.timeline_id == timeline_id]
