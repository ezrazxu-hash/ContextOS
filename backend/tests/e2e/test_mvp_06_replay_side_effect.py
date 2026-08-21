from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class MvpReplaySideEffectE2ETests(unittest.TestCase):
    def create_manager(self, calls):
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService
        from contextos.runtime.trace.collector import TraceCollector
        from contextos.runtime.trace.repository import InMemoryTraceRepository
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.tool.replay.manager import ReplayManager

        session_repository = InMemorySessionRepository()
        session = SessionService(session_repository).create_session("agent")
        timeline_service = TimelineService(InMemoryTimelineRepository(), session_repository)
        parent = timeline_service.create_initial_timeline(session.id)
        manager = ReplayManager(
            timeline_service=timeline_service,
            checkpoint_service=CheckpointService(InMemoryCheckpointStore()),
            trace_collector=TraceCollector(InMemoryTraceRepository()),
            tool_registry=ToolRegistry(
                [
                    ToolMetadata(
                        tool_id="send_email",
                        name="Send email",
                        side_effect=SideEffect.WRITE,
                        idempotent=False,
                    )
                ]
            ),
            impact_analyzer=lambda: None,
            tool_executor=lambda decision: calls.append(decision.tool_call_id),
        )
        return manager, parent

    def plan_payload(self, action: str, key: str, confirmation_token: str | None = None):
        return {
            "parent_timeline_id": "timeline-parent",
            "fork_checkpoint_id": "checkpoint-parent",
            "fork_message_id": "message-1",
            "idempotency_key": key,
            "decisions": [
                {
                    "tool_call_id": "send-email-call",
                    "tool_id": "send_email",
                    "action": action,
                    **({"confirmation_token": confirmation_token} if confirmation_token is not None else {}),
                }
            ],
        }

    def test_replay_side_effect_choices_confirmation_and_idempotency(self) -> None:
        from contextos.api.routes.replay import post_replay_plan
        from contextos.tool.replay.decision import ReplayAction

        self.assertEqual([action.value for action in ReplayAction], ["USE_HISTORY", "REINVOKE", "SKIP", "CANCEL"])

        calls: list[str] = []
        manager, parent = self.create_manager(calls)
        unconfirmed = self.plan_payload("REINVOKE", "unconfirmed")
        unconfirmed["parent_timeline_id"] = parent.id
        use_history = self.plan_payload("USE_HISTORY", "use-history")
        use_history["parent_timeline_id"] = parent.id
        confirmed = self.plan_payload("REINVOKE", "confirmed", confirmation_token="confirm-write")
        confirmed["parent_timeline_id"] = parent.id

        unconfirmed_result = post_replay_plan(unconfirmed, manager)
        use_history_result = post_replay_plan(use_history, manager)
        first_confirmed = post_replay_plan(confirmed, manager)
        second_confirmed = post_replay_plan(confirmed, manager)

        self.assertEqual(unconfirmed_result["body"]["status"], "rejected")
        self.assertEqual(unconfirmed_result["body"]["rejected_tool_call_ids"], ["send-email-call"])
        self.assertEqual(unconfirmed_result["body"]["rejection_reasons"], {"send-email-call": "confirmation_required"})
        self.assertEqual(use_history_result["body"]["status"], "completed")
        self.assertEqual(use_history_result["body"]["executed_tool_call_ids"], [])
        self.assertEqual(first_confirmed["body"]["status"], "completed")
        self.assertEqual(first_confirmed["body"]["executed_tool_call_ids"], ["send-email-call"])
        self.assertEqual(second_confirmed["body"], first_confirmed["body"])
        self.assertEqual(calls, ["send-email-call"])


if __name__ == "__main__":
    unittest.main()
