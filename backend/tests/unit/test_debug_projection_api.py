from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class DebugProjectionApiTests(unittest.TestCase):
    def create_state(self):
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
        timeline_repository = InMemoryTimelineRepository()
        checkpoint_store = InMemoryCheckpointStore()
        message_service = MessageService()
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
            graph_state={"node": "writer", "draft": "ready"},
            message_cursor=2,
            context_revision="ctx-rev-1",
        )
        user_message = message_service.create_message(
            session_id=session.id,
            role="user",
            content="Draft the release note",
            token_count=5,
        )
        assistant_message = message_service.create_message(
            session_id=session.id,
            role="assistant",
            content="Release note drafted",
            token_count=7,
            checkpoint_id=checkpoint.id,
            trace_id="trace-1",
            tool_call_ids=["tool-call-1"],
            tool_result_ids=["tool-result-1"],
        )
        trace_collector.record_model_call(
            trace_id="trace-1",
            session_id=session.id,
            timeline_id=timeline.id,
            checkpoint_id=checkpoint.id,
            component="writer",
            input_payload={"prompt": "Draft the release note"},
            output_payload={"text": "Release note drafted"},
            duration=0.1,
            message_id=assistant_message.id,
        )
        trace_collector.record_tool_call(
            trace_id="trace-tool",
            session_id=session.id,
            timeline_id=timeline.id,
            checkpoint_id=checkpoint.id,
            component="publish_tool",
            input_payload={"title": "Release note"},
            duration=0.2,
            message_id=assistant_message.id,
        )
        return {
            "session": session,
            "timeline": timeline,
            "checkpoint": checkpoint,
            "user_message": user_message,
            "assistant_message": assistant_message,
            "session_repository": session_repository,
            "timeline_repository": timeline_repository,
            "checkpoint_store": checkpoint_store,
            "message_service": message_service,
            "trace_repository": trace_repository,
        }

    def test_session_debug_index_reads_runtime_facts_without_second_fact_store(self) -> None:
        from contextos.api.routes.debug import get_debug_index
        from contextos.runtime.debug.projection import DebugProjection

        state = self.create_state()
        projection = DebugProjection(
            state["session_repository"],
            state["timeline_repository"],
            state["checkpoint_store"],
            state["message_service"],
            state["trace_repository"],
        )

        response = get_debug_index(state["session"].id, projection)

        self.assertEqual(response["status"], 200)
        body = response["body"]
        self.assertEqual(body["session"]["id"], state["session"].id)
        self.assertEqual(body["timelines"][0]["id"], state["timeline"].id)
        self.assertEqual(body["checkpoints"][0]["id"], state["checkpoint"].id)
        self.assertEqual(body["messages"][1]["id"], state["assistant_message"].id)
        self.assertEqual(body["state"]["graph_state"], {"node": "writer", "draft": "ready"})
        self.assertEqual(body["context"]["revision"], "ctx-rev-1")
        self.assertEqual(body["tools"], [{"call_id": "tool-call-1", "result_id": "tool-result-1"}])
        self.assertEqual(body["prompt_inputs"], [{"message_id": state["user_message"].id, "content": "Draft the release note"}])
        self.assertEqual([event["trace_id"] for event in body["traces"]["items"]], ["trace-1", "trace-tool"])
        self.assertFalse(hasattr(projection, "_debug_records"))

    def test_trace_page_filters_and_paginates_large_trace_list(self) -> None:
        from contextos.api.routes.debug import get_debug_index
        from contextos.runtime.debug.projection import DebugProjection
        from contextos.runtime.trace.collector import TraceCollector

        state = self.create_state()
        trace_collector = TraceCollector(state["trace_repository"])
        for index in range(60):
            trace_collector.record_model_call(
                trace_id=f"trace-page-{index}",
                session_id=state["session"].id,
                timeline_id=state["timeline"].id,
                checkpoint_id=state["checkpoint"].id,
                component="pager",
                input_payload=index,
                output_payload=index,
                duration=0.01,
                message_id=state["assistant_message"].id,
            )
        projection = DebugProjection(
            state["session_repository"],
            state["timeline_repository"],
            state["checkpoint_store"],
            state["message_service"],
            state["trace_repository"],
        )

        response = get_debug_index(
            state["session"].id,
            projection,
            message_id=state["assistant_message"].id,
            offset=10,
            limit=5,
        )

        self.assertEqual(response["status"], 200)
        traces = response["body"]["traces"]
        self.assertEqual(traces["total"], 62)
        self.assertEqual(traces["offset"], 10)
        self.assertEqual(traces["limit"], 5)
        self.assertEqual(len(traces["items"]), 5)
        self.assertEqual([event["trace_id"] for event in traces["items"]], [f"trace-page-{index}" for index in range(8, 13)])

    def test_trace_and_checkpoint_filters_limit_debug_trace_items(self) -> None:
        from contextos.api.routes.debug import get_debug_index
        from contextos.runtime.debug.projection import DebugProjection
        from contextos.runtime.trace.collector import TraceCollector

        state = self.create_state()
        other_checkpoint = state["checkpoint_store"].save(
            type(state["checkpoint"])(
                id="checkpoint-other",
                session_id=state["session"].id,
                timeline_id=state["timeline"].id,
                graph_state={"node": "other"},
                message_cursor=3,
                context_revision="ctx-rev-2",
                created_at=state["checkpoint"].created_at,
            )
        )
        trace_collector = TraceCollector(state["trace_repository"])
        trace_collector.record_model_call(
            trace_id="trace-other-checkpoint",
            session_id=state["session"].id,
            timeline_id=state["timeline"].id,
            checkpoint_id=other_checkpoint.id,
            component="other",
            input_payload="other",
            output_payload="other",
            duration=0.01,
            message_id=state["assistant_message"].id,
        )
        projection = DebugProjection(
            state["session_repository"],
            state["timeline_repository"],
            state["checkpoint_store"],
            state["message_service"],
            state["trace_repository"],
        )

        trace_response = get_debug_index(state["session"].id, projection, trace_id="trace-1")
        checkpoint_response = get_debug_index(state["session"].id, projection, checkpoint_id=other_checkpoint.id)

        self.assertEqual([event["trace_id"] for event in trace_response["body"]["traces"]["items"]], ["trace-1"])
        self.assertEqual(
            [event["checkpoint_id"] for event in checkpoint_response["body"]["traces"]["items"]],
            ["checkpoint-other"],
        )


if __name__ == "__main__":
    unittest.main()
