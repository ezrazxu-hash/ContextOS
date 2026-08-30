import unittest


class LegacyChatRuntimeTests(unittest.TestCase):
    def test_adapter_maps_orchestrator_events_in_order(self) -> None:
        from contextos.runtime.agent.legacy_runtime import LegacyChatRuntime
        from contextos.runtime.agent.protocol import AgentRunContext

        class Orchestrator:
            def __init__(self) -> None:
                self.calls = []

            def stream_runtime_events(self, session_id: str, timeline_id: str, trace_id: str):
                self.calls.append((session_id, timeline_id, trace_id))
                yield {"type": "token", "data": {"content": "OK"}}
                yield {"type": "done", "data": {"message_id": "message-1"}}

        orchestrator = Orchestrator()
        runtime = LegacyChatRuntime(orchestrator)

        events = list(runtime.stream_runtime_events(AgentRunContext("session-1", "timeline-1", "trace-1")))

        self.assertEqual(orchestrator.calls, [("session-1", "timeline-1", "trace-1")])
        self.assertEqual([event.type for event in events], ["token", "graph_finished"])
        self.assertEqual([event.data for event in events], [{"content": "OK"}, {"message_id": "message-1"}])

    def test_adapter_propagates_orchestrator_exceptions(self) -> None:
        from contextos.runtime.agent.legacy_runtime import LegacyChatRuntime
        from contextos.runtime.agent.protocol import AgentRunContext

        class Orchestrator:
            def stream_runtime_events(self, session_id: str, timeline_id: str, trace_id: str):
                del session_id, timeline_id, trace_id
                raise RuntimeError("context builder failed")
                yield

        runtime = LegacyChatRuntime(Orchestrator())

        with self.assertRaisesRegex(RuntimeError, "context builder failed"):
            list(runtime.stream_runtime_events(AgentRunContext("session-1", "timeline-1", "trace-1")))


if __name__ == "__main__":
    unittest.main()
