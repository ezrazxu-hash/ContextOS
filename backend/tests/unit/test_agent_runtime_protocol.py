import unittest


class AgentRuntimeProtocolTests(unittest.TestCase):
    def test_fake_runtime_conforms_to_agent_runtime_protocol(self) -> None:
        from contextos.runtime.agent.events import RuntimeEvent
        from contextos.runtime.agent.protocol import AgentRunContext, AgentRuntime

        class FakeRuntime:
            def stream_runtime_events(self, run_context: AgentRunContext):
                yield RuntimeEvent(type="graph_started", data={"session_id": run_context.session_id})
                yield RuntimeEvent(type="graph_finished", data={})

        runtime = FakeRuntime()

        self.assertIsInstance(runtime, AgentRuntime)
        self.assertEqual(
            [event.type for event in runtime.stream_runtime_events(AgentRunContext("session-1", "timeline-1", "trace-1"))],
            ["graph_started", "graph_finished"],
        )

    def test_run_context_requires_session_timeline_and_trace(self) -> None:
        from contextos.runtime.agent.protocol import AgentRunContext

        cases = [
            ("", "timeline-1", "trace-1", "session_id"),
            ("session-1", "", "trace-1", "timeline_id"),
            ("session-1", "timeline-1", "", "trace_id"),
        ]

        for session_id, timeline_id, trace_id, field_name in cases:
            with self.subTest(field_name=field_name):
                with self.assertRaisesRegex(ValueError, field_name):
                    AgentRunContext(session_id, timeline_id, trace_id)


if __name__ == "__main__":
    unittest.main()
