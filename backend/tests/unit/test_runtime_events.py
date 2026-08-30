import unittest


class RuntimeEventContractTests(unittest.TestCase):
    def test_legacy_chat_events_round_trip_without_losing_payload(self) -> None:
        from contextos.runtime.agent.events import legacy_event_to_runtime_event, runtime_event_to_legacy_event

        legacy_events = [
            {"type": "token", "data": {"content": "Hel", "message_id": "stream"}},
            {"type": "tool_call", "data": {"call_id": "call-1", "name": "lookup"}},
            {"type": "tool_result", "data": {"call_id": "call-1", "content": "ok"}},
            {"type": "checkpoint", "data": {"graph_state": {"node": "chat"}, "message_cursor": 2}},
            {"type": "done", "data": {"message_id": "message-1", "checkpoint_id": "checkpoint-1"}},
            {"type": "error", "data": {"message": "provider unavailable", "code": "llm.request_failed"}},
        ]

        round_tripped = [
            runtime_event_to_legacy_event(legacy_event_to_runtime_event(event))
            for event in legacy_events
        ]

        self.assertEqual(round_tripped, legacy_events)

    def test_done_and_error_map_to_graph_terminal_events(self) -> None:
        from contextos.runtime.agent.events import legacy_event_to_runtime_event

        done = legacy_event_to_runtime_event({"type": "done", "data": {"message_id": "message-1"}})
        error = legacy_event_to_runtime_event({"type": "error", "data": {"code": "failed"}})

        self.assertEqual(done.type, "graph_finished")
        self.assertEqual(error.type, "graph_failed")
        self.assertEqual(done.data, {"message_id": "message-1"})
        self.assertEqual(error.data, {"code": "failed"})

    def test_unknown_event_type_fails_explicitly(self) -> None:
        from contextos.runtime.agent.events import RuntimeEventContractError, legacy_event_to_runtime_event

        with self.assertRaisesRegex(RuntimeEventContractError, "unknown runtime event type"):
            legacy_event_to_runtime_event({"type": "mystery", "data": {}})

    def test_runtime_event_json_round_trip(self) -> None:
        from contextos.runtime.agent.events import RuntimeEvent, runtime_event_from_dict

        event = RuntimeEvent(
            type="node_started",
            data={"node_id": "planner", "timeline_id": "timeline-1"},
        )

        restored = runtime_event_from_dict(event.to_dict())

        self.assertEqual(restored, event)


if __name__ == "__main__":
    unittest.main()
