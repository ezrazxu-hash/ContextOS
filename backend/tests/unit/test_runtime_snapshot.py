from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class RuntimeSnapshotTests(unittest.TestCase):
    def create_state(self):
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService
        from contextos.runtime.trace.collector import TraceCollector
        from contextos.runtime.trace.repository import InMemoryTraceRepository

        session_repository = InMemorySessionRepository()
        timeline_repository = InMemoryTimelineRepository()
        checkpoint_store = InMemoryCheckpointStore()
        trace_repository = InMemoryTraceRepository()

        session_service = SessionService(session_repository)
        timeline_service = TimelineService(timeline_repository, session_repository)
        checkpoint_service = CheckpointService(checkpoint_store)
        trace_collector = TraceCollector(trace_repository)

        session = session_service.create_session("research-agent")
        timeline = timeline_service.create_initial_timeline(session.id)
        checkpoint = checkpoint_service.save_checkpoint(
            session_id=session.id,
            timeline_id=timeline.id,
            graph_state={"node": "writer"},
            message_cursor=5,
            context_revision="ctx-rev-1",
        )
        trace_collector.record_model_call(
            trace_id="trace-1",
            session_id=session.id,
            timeline_id=timeline.id,
            checkpoint_id=checkpoint.id,
            component="writer",
            input_payload="input",
            output_payload="output",
            duration=0.1,
            message_id="message-1",
        )
        return session, timeline, checkpoint, session_repository, timeline_repository, checkpoint_store, trace_repository

    def test_cleared_browser_state_rehydrates_current_session_from_backend(self) -> None:
        from contextos.api.routes.runtime_snapshot import get_runtime_snapshot
        from contextos.runtime.session.snapshot_service import RuntimeSnapshotService

        session, timeline, checkpoint, session_repository, timeline_repository, checkpoint_store, trace_repository = self.create_state()
        browser_cache = {"timeline": "stale", "checkpoint": "stale"}
        browser_cache.clear()

        response = get_runtime_snapshot(
            session.id,
            RuntimeSnapshotService(session_repository, timeline_repository, checkpoint_store, trace_repository),
        )

        self.assertEqual(browser_cache, {})
        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["session"]["id"], session.id)
        self.assertEqual(response["body"]["current_timeline"]["id"], timeline.id)
        self.assertEqual(response["body"]["checkpoint"]["id"], checkpoint.id)
        self.assertEqual(response["body"]["message_index"], 5)
        self.assertEqual(response["body"]["context_revision"], "ctx-rev-1")
        self.assertEqual(response["body"]["trace_summary"][0]["trace_id"], "trace-1")

    def test_new_snapshot_service_reads_existing_backend_state_after_restart(self) -> None:
        from contextos.runtime.session.snapshot_service import RuntimeSnapshotService

        session, timeline, checkpoint, session_repository, timeline_repository, checkpoint_store, trace_repository = self.create_state()
        restarted_service = RuntimeSnapshotService(session_repository, timeline_repository, checkpoint_store, trace_repository)

        snapshot = restarted_service.rehydrate(session.id)

        self.assertEqual(snapshot["session"]["id"], session.id)
        self.assertEqual(snapshot["current_timeline"]["id"], timeline.id)
        self.assertEqual(snapshot["checkpoint"]["id"], checkpoint.id)

    def test_snapshot_reads_current_facts_without_storing_second_copy(self) -> None:
        from contextos.runtime.session.snapshot_service import RuntimeSnapshotService
        from contextos.runtime.timeline.service import TimelineService

        session, timeline, _, session_repository, timeline_repository, checkpoint_store, trace_repository = self.create_state()
        snapshot_service = RuntimeSnapshotService(session_repository, timeline_repository, checkpoint_store, trace_repository)
        timeline_service = TimelineService(timeline_repository, session_repository)
        child = timeline_service.fork_timeline(timeline.id, "checkpoint-1", "message-1")
        timeline_service.activate_timeline(child.id)

        snapshot = snapshot_service.rehydrate(session.id)

        self.assertEqual(snapshot["session"]["current_timeline_id"], child.id)
        self.assertEqual(snapshot["current_timeline"]["id"], child.id)
        self.assertFalse(hasattr(snapshot_service, "_snapshots"))


if __name__ == "__main__":
    unittest.main()
