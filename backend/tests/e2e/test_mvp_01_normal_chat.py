from pathlib import Path
import json
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class MvpNormalChatE2ETests(unittest.TestCase):
    def test_normal_chat_creates_session_tool_projection_checkpoint_and_trace(self) -> None:
        from contextos.api.routes.chat import stream_chat_events
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
        from contextos.runtime.session.message_service import MessageService
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService
        from contextos.runtime.trace.collector import TraceCollector
        from contextos.runtime.trace.repository import InMemoryTraceRepository

        session_repository = InMemorySessionRepository()
        session = SessionService(session_repository).create_session("research-agent")
        timeline = TimelineService(InMemoryTimelineRepository(), session_repository).create_initial_timeline(session.id)
        message_service = MessageService()
        checkpoint_service = CheckpointService(InMemoryCheckpointStore())
        trace_collector = TraceCollector(InMemoryTraceRepository())

        frames = stream_chat_events(
            session_id=session.id,
            timeline_id=timeline.id,
            trace_id="trace-mvp-1",
            runtime_events=[
                {"type": "tool_call", "data": {"call_id": "call-weather", "name": "weather_lookup"}},
                {"type": "tool_result", "data": {"call_id": "call-weather", "content": "sunny"}},
                {"type": "token", "data": {"content": "It is sunny."}},
                {
                    "type": "checkpoint",
                    "data": {"graph_state": {"answer": "It is sunny."}, "message_cursor": 1, "context_revision": "ctx-mvp-1"},
                },
                {"type": "done", "data": {}},
            ],
            message_service=message_service,
            trace_collector=trace_collector,
            checkpoint_service=checkpoint_service,
        )

        messages, _ = message_service.list_messages(session.id)
        assistant = messages[0]
        done_data = json.loads(frames[-1].split("data: ", 1)[1])
        checkpoint = checkpoint_service.restore_checkpoint(assistant.checkpoint_id)
        trace_steps = [event.step_type for event in trace_collector.list_by_session(session.id)]

        self.assertEqual(session.agent_template_id, "research-agent")
        self.assertEqual(assistant.content, "It is sunny.")
        self.assertEqual(assistant.tool_call_ids, ["call-weather"])
        self.assertEqual(assistant.tool_result_ids, ["call-weather"])
        self.assertEqual(done_data["message_id"], assistant.id)
        self.assertEqual(checkpoint.graph_state, {"answer": "It is sunny."})
        self.assertIn("tool_call", trace_steps)
        self.assertIn("tool_result", trace_steps)
        self.assertIn("model_call", trace_steps)


if __name__ == "__main__":
    unittest.main()
