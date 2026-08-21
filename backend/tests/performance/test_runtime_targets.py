from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class RuntimeTargetPerformanceTests(unittest.TestCase):
    def test_benchmark_report_contains_p50_and_p95(self) -> None:
        from contextos.performance.benchmark import benchmark_report

        report = benchmark_report(
            "compiler",
            samples_ms=[10.0, 20.0, 30.0, 40.0, 50.0],
            target_ms=100.0,
        )

        self.assertEqual(report["name"], "compiler")
        self.assertEqual(report["p50_ms"], 30.0)
        self.assertEqual(report["p95_ms"], 50.0)
        self.assertEqual(report["target_ms"], 100.0)
        self.assertEqual(report["status"], "pass")

    def test_debug_index_pages_large_message_history_without_full_load(self) -> None:
        from contextos.runtime.debug.projection import DebugProjection
        from contextos.runtime.session.message import MessageRole, MessageStatus, SessionMessage
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.trace.repository import InMemoryTraceRepository
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore

        class CountingMessageService:
            def __init__(self) -> None:
                self.calls = []

            def list_messages(self, session_id: str, after_cursor: int | None = None, limit: int = 50):
                self.calls.append({"session_id": session_id, "after_cursor": after_cursor, "limit": limit})
                page = [
                    SessionMessage(
                        id=f"message-{cursor}",
                        session_id=session_id,
                        cursor=cursor,
                        role=MessageRole.USER,
                        content=f"message {cursor}",
                        status=MessageStatus.COMPLETED,
                        token_count=1,
                    )
                    for cursor in range(101, 151)
                ]
                return page, 150

        session_repository = InMemorySessionRepository()
        session = SessionService(session_repository).create_session("research-agent")
        message_service = CountingMessageService()
        projection = DebugProjection(
            session_repository,
            InMemoryTimelineRepository(),
            InMemoryCheckpointStore(),
            message_service,
            InMemoryTraceRepository(),
        )

        body = projection.index(session.id, message_after_cursor=100, message_limit=50)

        self.assertEqual(message_service.calls, [{"session_id": session.id, "after_cursor": 100, "limit": 50}])
        self.assertEqual(len(body["messages"]), 50)
        self.assertEqual(body["message_page"], {"after_cursor": 100, "limit": 50, "next_cursor": 150})


if __name__ == "__main__":
    unittest.main()
