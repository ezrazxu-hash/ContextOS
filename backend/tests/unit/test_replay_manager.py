import unittest


class ReplayManagerTests(unittest.TestCase):
    def create_services(self):
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

        session_repository = InMemorySessionRepository()
        session_service = SessionService(session_repository)
        timeline_service = TimelineService(InMemoryTimelineRepository(), session_repository)
        checkpoint_store = InMemoryCheckpointStore()
        checkpoint_service = CheckpointService(checkpoint_store)
        trace_repository = InMemoryTraceRepository()
        trace_collector = TraceCollector(trace_repository)
        registry = ToolRegistry(
            [
                ToolMetadata(
                    tool_id="send_email",
                    name="Send email",
                    side_effect=SideEffect.WRITE,
                    idempotent=False,
                )
            ]
        )
        return (
            session_service,
            timeline_service,
            checkpoint_service,
            checkpoint_store,
            trace_collector,
            trace_repository,
            registry,
        )

    def test_unconfirmed_send_email_is_not_called(self) -> None:
        from contextos.tool.replay.decision import ReplayAction, ReplayDecision
        from contextos.tool.replay.manager import ReplayManager, ReplayPlan

        session_service, timeline_service, checkpoint_service, _, trace_collector, _, registry = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        events: list[str] = []
        calls: list[str] = []

        def execute(decision):
            events.append("execute")
            calls.append(decision.tool_call_id)

        manager = ReplayManager(
            timeline_service=timeline_service,
            checkpoint_service=checkpoint_service,
            trace_collector=trace_collector,
            tool_registry=registry,
            impact_analyzer=lambda: events.append("impact"),
            tool_executor=execute,
        )

        result = manager.execute_plan(
            ReplayPlan(
                parent_timeline_id=parent.id,
                fork_checkpoint_id="checkpoint-parent",
                fork_message_id="message-1",
                decisions=[
                    ReplayDecision(
                        tool_call_id="send-email-call",
                        tool_id="send_email",
                        action=ReplayAction.REINVOKE,
                    )
                ],
                idempotency_key="replay-1",
            )
        )

        self.assertEqual(events, ["impact"])
        self.assertEqual(calls, [])
        self.assertEqual(result.status, "rejected")
        self.assertEqual(result.rejected_tool_call_ids, ["send-email-call"])
        self.assertEqual(len(timeline_service.list_timelines(session.id)), 1)

    def test_confirmed_reinvoke_runs_once_and_writes_timeline_trace_checkpoint(self) -> None:
        from contextos.tool.replay.decision import ReplayAction, ReplayDecision
        from contextos.tool.replay.manager import ReplayManager, ReplayPlan

        (
            session_service,
            timeline_service,
            checkpoint_service,
            checkpoint_store,
            trace_collector,
            trace_repository,
            registry,
        ) = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        events: list[str] = []
        calls: list[str] = []

        def execute(decision):
            events.append("execute")
            calls.append(decision.tool_call_id)

        manager = ReplayManager(
            timeline_service=timeline_service,
            checkpoint_service=checkpoint_service,
            trace_collector=trace_collector,
            tool_registry=registry,
            impact_analyzer=lambda: events.append("impact"),
            tool_executor=execute,
        )

        result = manager.execute_plan(
            ReplayPlan(
                parent_timeline_id=parent.id,
                fork_checkpoint_id="checkpoint-parent",
                fork_message_id="message-1",
                decisions=[
                    ReplayDecision(
                        tool_call_id="send-email-call",
                        tool_id="send_email",
                        action=ReplayAction.REINVOKE,
                        confirmation_token="confirm-write",
                    )
                ],
                idempotency_key="replay-2",
            )
        )

        self.assertEqual(events, ["impact", "execute"])
        self.assertEqual(calls, ["send-email-call"])
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.executed_tool_call_ids, ["send-email-call"])
        self.assertNotEqual(result.timeline_id, parent.id)
        self.assertEqual(len(timeline_service.list_timelines(session.id)), 2)
        self.assertEqual(len(checkpoint_store.list_by_timeline(result.timeline_id)), 1)
        self.assertEqual(len(trace_repository.list_by_trace(result.trace_id)), 1)

    def test_same_idempotency_key_reuses_result_and_runs_once(self) -> None:
        from contextos.tool.replay.decision import ReplayAction, ReplayDecision
        from contextos.tool.replay.manager import ReplayManager, ReplayPlan

        session_service, timeline_service, checkpoint_service, _, trace_collector, _, registry = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        calls: list[str] = []
        manager = ReplayManager(
            timeline_service=timeline_service,
            checkpoint_service=checkpoint_service,
            trace_collector=trace_collector,
            tool_registry=registry,
            impact_analyzer=lambda: None,
            tool_executor=lambda decision: calls.append(decision.tool_call_id),
        )
        plan = ReplayPlan(
            parent_timeline_id=parent.id,
            fork_checkpoint_id="checkpoint-parent",
            fork_message_id="message-1",
            decisions=[
                ReplayDecision(
                    tool_call_id="send-email-call",
                    tool_id="send_email",
                    action=ReplayAction.REINVOKE,
                    confirmation_token="confirm-write",
                )
            ],
            idempotency_key="same-key",
        )

        first = manager.execute_plan(plan)
        second = manager.execute_plan(plan)

        self.assertEqual(first, second)
        self.assertEqual(calls, ["send-email-call"])
        self.assertEqual(len(timeline_service.list_timelines(session.id)), 2)

    def test_replay_route_returns_manager_result(self) -> None:
        from contextos.api.routes.replay import post_replay_plan
        from contextos.tool.replay.manager import ReplayResult

        class FakeReplayManager:
            def execute_plan(self, plan):
                self.plan = plan
                return ReplayResult(
                    status="completed",
                    timeline_id="timeline-replay",
                    trace_id="trace-replay",
                    checkpoint_id="checkpoint-replay",
                    executed_tool_call_ids=["send-email-call"],
                    rejected_tool_call_ids=[],
                )

        manager = FakeReplayManager()

        response = post_replay_plan(
            {
                "parent_timeline_id": "timeline-parent",
                "fork_checkpoint_id": "checkpoint-parent",
                "fork_message_id": "message-1",
                "idempotency_key": "route-key",
                "decisions": [
                    {
                        "tool_call_id": "send-email-call",
                        "tool_id": "send_email",
                        "action": "REINVOKE",
                        "confirmation_token": "confirm-write",
                    }
                ],
            },
            manager,
        )

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["timeline_id"], "timeline-replay")
        self.assertEqual(manager.plan.idempotency_key, "route-key")


if __name__ == "__main__":
    unittest.main()
