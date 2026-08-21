from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class MvpEditImpactE2ETests(unittest.TestCase):
    def test_edit_creates_revision_timeline_conflict_issue_and_does_not_run_old_tool(self) -> None:
        from contextos.api.routes.message_actions import post_message_context_only
        from contextos.api.routes.messages import get_message_original, patch_message
        from contextos.runtime.session.message_revision_service import MessageRevisionService
        from contextos.runtime.session.message_service import MessageService
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService

        session_repository = InMemorySessionRepository()
        session = SessionService(session_repository).create_session("research-agent")
        timeline_service = TimelineService(InMemoryTimelineRepository(), session_repository)
        original_timeline = timeline_service.create_initial_timeline(session.id)
        message_service = MessageService()
        revision_service = MessageRevisionService()
        message = message_service.create_message(
            session_id=session.id,
            role="assistant",
            content="订单已经发货。",
            checkpoint_id="checkpoint-before-edit",
            trace_id="trace-before-edit",
            tool_call_ids=["order-status-call"],
            tool_result_ids=["order-status-call"],
        )
        message_service.create_message(session.id, "assistant", "旧 Timeline 的后续消息", checkpoint_id="checkpoint-after-edit")
        replay_calls: list[str] = []

        edit = patch_message(
            message.id,
            {
                "new_content": "订单已经退款。",
                "operator": "user",
                "reason": "correct status",
                "tool_results": [{"call_id": "order-status-call", "content": {"order_id": "order-1", "status": "shipped"}}],
            },
            message_service,
            revision_service,
            tool_runner=lambda call_id: replay_calls.append(call_id),
        )
        context_only = post_message_context_only(
            message.id,
            {"parent_timeline_id": original_timeline.id, "revision_id": edit["body"]["revision_id"]},
            timeline_service,
            message_service,
            revision_service,
            agent_runner=lambda: replay_calls.append("agent"),
        )
        original = get_message_original(message.id, revision_service)

        self.assertEqual(edit["status"], 200)
        self.assertEqual(original["body"]["original_content"], "订单已经发货。")
        self.assertEqual(revision_service.current_content(message.id), "订单已经退款。")
        self.assertEqual(context_only["status"], 200)
        self.assertEqual(context_only["body"]["timeline"]["parent_timeline_id"], original_timeline.id)
        self.assertEqual(timeline_service.get_timeline(original_timeline.id).id, original_timeline.id)
        self.assertEqual(context_only["body"]["working_context_messages"], [{"message_id": message.id, "content": "订单已经退款。"}])
        self.assertEqual(edit["body"]["impact"]["issues"][0]["issue_type"], "message_tool_result_conflict")
        self.assertEqual(edit["body"]["impact"]["issues"][0]["related_ids"], ["order-status-call"])
        self.assertEqual(edit["body"]["impact"]["issues"][0]["evidence"]["tool_result_call_id"], "order-status-call")
        self.assertEqual(replay_calls, [])


if __name__ == "__main__":
    unittest.main()
