import json
import unittest


class SseChatStreamTests(unittest.TestCase):
    def create_services(self):
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
        from contextos.runtime.session.message_service import MessageService
        from contextos.runtime.trace.collector import TraceCollector
        from contextos.runtime.trace.repository import InMemoryTraceRepository

        return (
            MessageService(),
            TraceCollector(InMemoryTraceRepository()),
            CheckpointService(InMemoryCheckpointStore()),
        )

    def test_normal_reply_streams_tokens(self) -> None:
        from contextos.api.routes.chat import stream_chat_events

        message_service, trace_collector, checkpoint_service = self.create_services()
        frames = stream_chat_events(
            session_id="session-1",
            timeline_id="timeline-1",
            trace_id="trace-1",
            runtime_events=[
                {"type": "token", "data": {"content": "Hel"}},
                {"type": "token", "data": {"content": "lo"}},
                {
                    "type": "checkpoint",
                    "data": {"graph_state": {"answer": "Hello"}, "message_cursor": 1, "context_revision": "ctx-1"},
                },
                {"type": "done", "data": {}},
            ],
            message_service=message_service,
            trace_collector=trace_collector,
            checkpoint_service=checkpoint_service,
        )

        self.assertTrue(frames[0].startswith("event: token\n"))
        self.assertIn('"content": "Hel"', frames[0])
        self.assertTrue(frames[1].startswith("event: token\n"))
        self.assertTrue(frames[-1].startswith("event: done\n"))

    def test_tool_call_and_result_are_projected(self) -> None:
        from contextos.api.routes.chat import stream_chat_events

        message_service, trace_collector, checkpoint_service = self.create_services()
        frames = stream_chat_events(
            session_id="session-1",
            timeline_id="timeline-1",
            trace_id="trace-1",
            runtime_events=[
                {"type": "tool_call", "data": {"call_id": "call-1", "name": "lookup"}},
                {"type": "tool_result", "data": {"call_id": "call-1", "content": "shipped"}},
            ],
            message_service=message_service,
            trace_collector=trace_collector,
            checkpoint_service=checkpoint_service,
        )

        self.assertTrue(frames[0].startswith("event: tool_call\n"))
        self.assertIn('"call_id": "call-1"', frames[0])
        self.assertTrue(frames[1].startswith("event: tool_result\n"))
        self.assertIn('"content": "shipped"', frames[1])

    def test_disconnect_after_first_frame_can_rehydrate_message_trace_and_checkpoint(self) -> None:
        from contextos.api.routes.chat import stream_chat_events

        message_service, trace_collector, checkpoint_service = self.create_services()
        frames = stream_chat_events(
            session_id="session-1",
            timeline_id="timeline-1",
            trace_id="trace-1",
            runtime_events=[
                {"type": "token", "data": {"content": "Hello"}},
                {
                    "type": "checkpoint",
                    "data": {"graph_state": {"answer": "Hello"}, "message_cursor": 1, "context_revision": "ctx-1"},
                },
                {"type": "done", "data": {}},
            ],
            message_service=message_service,
            trace_collector=trace_collector,
            checkpoint_service=checkpoint_service,
        )
        disconnected_client_frames = frames[:1]

        messages, _ = message_service.list_messages("session-1")
        traces = trace_collector.list_by_session("session-1")
        restored = checkpoint_service.restore_checkpoint(messages[0].checkpoint_id)
        done_data = json.loads(frames[-1].split("data: ", 1)[1])

        self.assertEqual(len(disconnected_client_frames), 1)
        self.assertEqual(messages[0].content, "Hello")
        self.assertEqual(traces[0].trace_id, "trace-1")
        self.assertEqual(restored.graph_state, {"answer": "Hello"})
        self.assertEqual(done_data["message_id"], messages[0].id)


if __name__ == "__main__":
    unittest.main()
