from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class TraceCollectorTests(unittest.TestCase):
    def create_collector(self):
        from contextos.runtime.trace.collector import TraceCollector
        from contextos.runtime.trace.repository import InMemoryTraceRepository

        return TraceCollector(InMemoryTraceRepository())

    def test_model_call_records_prd_trace_fields_and_summarizes_large_input(self) -> None:
        collector = self.create_collector()
        large_input = "search context " * 40

        event = collector.record_model_call(
            trace_id="trace-1",
            session_id="session-1",
            timeline_id="timeline-1",
            checkpoint_id="checkpoint-1",
            component="planner",
            input_payload=large_input,
            output_payload="plan done",
            duration=0.25,
            message_id="message-1",
        )

        self.assertEqual(event.step_type, "model_call")
        self.assertEqual(event.status, "success")
        self.assertEqual(event.trace_id, "trace-1")
        self.assertEqual(event.session_id, "session-1")
        self.assertEqual(event.timeline_id, "timeline-1")
        self.assertEqual(event.checkpoint_id, "checkpoint-1")
        self.assertEqual(event.component, "planner")
        self.assertLess(len(event.input_summary), len(large_input))
        self.assertNotEqual(event.input_summary, large_input)

    def test_tool_call_and_result_are_queryable_by_trace(self) -> None:
        collector = self.create_collector()

        call = collector.record_tool_call(
            trace_id="trace-tool",
            session_id="session-1",
            timeline_id="timeline-1",
            checkpoint_id="checkpoint-1",
            component="web_search",
            input_payload={"query": "ContextOS"},
            duration=0.1,
            message_id="message-2",
        )
        result = collector.record_tool_result(
            trace_id="trace-tool",
            session_id="session-1",
            timeline_id="timeline-1",
            checkpoint_id="checkpoint-1",
            component="web_search",
            output_payload={"results": 3},
            duration=0.2,
            message_id="message-2",
        )

        events = collector.list_by_trace("trace-tool")

        self.assertEqual([event.step_type for event in events], ["tool_call", "tool_result"])
        self.assertEqual([event.id for event in events], [call.id, result.id])

    def test_failed_event_records_failed_status_and_duration(self) -> None:
        collector = self.create_collector()

        event = collector.record_failed(
            trace_id="trace-failed",
            session_id="session-1",
            timeline_id="timeline-1",
            checkpoint_id="checkpoint-1",
            step_type="tool_result",
            component="web_search",
            input_payload="query",
            error="timeout",
            duration=1.75,
            message_id="message-3",
        )

        self.assertEqual(event.status, "failed")
        self.assertEqual(event.duration, 1.75)
        self.assertIn("timeout", event.output_summary)

    def test_runtime_node_trace_records_agent_version_node_and_route(self) -> None:
        collector = self.create_collector()

        event = collector.record_runtime_node(
            trace_id="trace-runtime",
            session_id="session-1",
            timeline_id="timeline-1",
            checkpoint_id="checkpoint-1",
            run_id="run-1",
            agent_version_id="agent_v1",
            node_id="router",
            node_type="router",
            input_payload={"intent": "billing"},
            output_payload={"route": "billing"},
            duration=0.03,
            status="success",
            route="billing",
        )

        self.assertEqual(event.step_type, "runtime_node")
        self.assertEqual(event.run_id, "run-1")
        self.assertEqual(event.agent_version_id, "agent_v1")
        self.assertEqual(event.node_id, "router")
        self.assertEqual(event.node_type, "router")
        self.assertEqual(event.route, "billing")
        self.assertEqual(event.to_dict()["agent_version_id"], "agent_v1")

    def test_trace_routes_query_by_session_message_and_trace(self) -> None:
        from contextos.api.routes.trace import get_message_trace, get_session_trace, get_trace

        collector = self.create_collector()
        collector.record_model_call(
            trace_id="trace-1",
            session_id="session-1",
            timeline_id="timeline-1",
            checkpoint_id="checkpoint-1",
            component="planner",
            input_payload="input",
            output_payload="output",
            duration=0.1,
            message_id="message-1",
        )

        self.assertEqual(get_session_trace("session-1", collector)["status"], 200)
        self.assertEqual(get_message_trace("message-1", collector)["body"][0]["trace_id"], "trace-1")
        self.assertEqual(get_trace("trace-1", collector)["body"][0]["message_id"], "message-1")


if __name__ == "__main__":
    unittest.main()
