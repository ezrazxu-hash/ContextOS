import unittest


class AgentGraphStateTests(unittest.TestCase):
    def test_minimal_state_with_required_input_is_valid(self) -> None:
        from contextos.runtime.graph.state import validate_agent_graph_state

        state = {"session_id": "session-1", "timeline_id": "timeline-1", "run_id": "run-1", "input": "hello"}

        self.assertEqual(validate_agent_graph_state(state), state)

    def test_extra_fields_remain_compatible(self) -> None:
        from contextos.runtime.graph.state import validate_agent_graph_state

        state = {
            "session_id": "session-1",
            "timeline_id": "timeline-1",
            "run_id": "run-1",
            "input": "hello",
            "legacy_key": {"kept": True},
        }

        self.assertEqual(validate_agent_graph_state(state)["legacy_key"], {"kept": True})

    def test_missing_required_input_fails_at_entry(self) -> None:
        from contextos.runtime.graph.state import AgentGraphStateValidationError, validate_agent_graph_state

        with self.assertRaisesRegex(AgentGraphStateValidationError, "input"):
            validate_agent_graph_state({"session_id": "session-1", "timeline_id": "timeline-1", "run_id": "run-1"})


if __name__ == "__main__":
    unittest.main()
