from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class CheckpointServiceTests(unittest.TestCase):
    def test_save_step_creates_checkpoint_bound_to_session_and_timeline(self) -> None:
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore

        checkpoint = CheckpointService(InMemoryCheckpointStore()).save_checkpoint(
            session_id="session-1",
            timeline_id="timeline-1",
            graph_state={"node": "writer", "step": 1},
            message_cursor=7,
            context_revision="ctx-rev-1",
            parent_checkpoint_id="checkpoint-parent",
        )

        self.assertEqual(checkpoint.session_id, "session-1")
        self.assertEqual(checkpoint.timeline_id, "timeline-1")
        self.assertEqual(checkpoint.graph_state, {"node": "writer", "step": 1})
        self.assertEqual(checkpoint.message_cursor, 7)
        self.assertEqual(checkpoint.context_revision, "ctx-rev-1")
        self.assertEqual(checkpoint.parent_checkpoint_id, "checkpoint-parent")

    def test_restore_by_checkpoint_id_returns_same_graph_state(self) -> None:
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore

        service = CheckpointService(InMemoryCheckpointStore())
        saved = service.save_checkpoint(
            session_id="session-1",
            timeline_id="timeline-1",
            graph_state={"messages": ["hello"], "cursor": 1},
            message_cursor=1,
            context_revision="ctx-rev-1",
        )

        restored = service.restore_checkpoint(saved.id)

        self.assertEqual(restored.graph_state, {"messages": ["hello"], "cursor": 1})

    def test_reading_old_checkpoint_does_not_modify_snapshot(self) -> None:
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore

        service = CheckpointService(InMemoryCheckpointStore())
        graph_state = {"messages": ["hello"], "nested": {"step": 1}}
        saved = service.save_checkpoint(
            session_id="session-1",
            timeline_id="timeline-1",
            graph_state=graph_state,
            message_cursor=1,
            context_revision="ctx-rev-1",
        )
        graph_state["messages"].append("mutated-after-save")

        restored = service.restore_checkpoint(saved.id)
        restored.graph_state["nested"]["step"] = 99
        restored_again = service.restore_checkpoint(saved.id)

        self.assertEqual(restored_again.graph_state, {"messages": ["hello"], "nested": {"step": 1}})


if __name__ == "__main__":
    unittest.main()
