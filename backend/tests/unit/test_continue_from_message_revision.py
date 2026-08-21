import unittest


class ContinueFromMessageRevisionTests(unittest.TestCase):
    def create_services(self):
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
        from contextos.runtime.session.message_revision_service import MessageRevisionService
        from contextos.runtime.session.message_service import MessageService
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService

        session_repository = InMemorySessionRepository()
        return (
            SessionService(session_repository),
            TimelineService(InMemoryTimelineRepository(), session_repository),
            CheckpointService(InMemoryCheckpointStore()),
            MessageService(),
            MessageRevisionService(),
        )

    def test_continues_from_message_checkpoint_with_revision_applied(self) -> None:
        from contextos.runtime.graph.executor import RuntimeExecutor
        from contextos.runtime.timeline.continue_service import ContinueService

        session_service, timeline_service, checkpoint_service, message_service, revision_service = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        checkpoint = checkpoint_service.save_checkpoint(session.id, parent.id, {"answer": "original"}, 1, "ctx-1")
        message = message_service.create_message(session.id, "assistant", "original", checkpoint_id=checkpoint.id)
        revision = revision_service.append_revision(message, "edited", "user", "continue")

        class Runner:
            def __init__(self) -> None:
                self.seen_state = None

            def run(self, graph_state, runtime_context):
                self.seen_state = graph_state
                return {**graph_state, "continued": True, "timeline_id": runtime_context.timeline_id}

        runner = Runner()
        result = ContinueService(timeline_service, checkpoint_service, RuntimeExecutor(runner, checkpoint_service)).continue_from_revision(
            parent_timeline_id=parent.id,
            message_id=message.id,
            revision_id=revision.id,
            checkpoint_id=checkpoint.id,
            trace_id="trace-new",
            revision_service=revision_service,
        )

        self.assertEqual(runner.seen_state["answer"], "original")
        self.assertEqual(runner.seen_state["message_revisions"][message.id], "edited")
        self.assertEqual(result.execution.runtime_context.trace_id, "trace-new")
        self.assertEqual(result.execution.runtime_context.timeline_id, result.timeline.id)

    def test_new_checkpoint_belongs_to_new_timeline_and_old_future_tool_is_not_replayed(self) -> None:
        from contextos.runtime.graph.executor import RuntimeExecutor
        from contextos.runtime.timeline.continue_service import ContinueService

        session_service, timeline_service, checkpoint_service, message_service, revision_service = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        checkpoint = checkpoint_service.save_checkpoint(session.id, parent.id, {"step": "before_tool"}, 1, "ctx-1")
        checkpoint_service.save_checkpoint(session.id, parent.id, {"step": "old_future_tool"}, 2, "ctx-2", parent_checkpoint_id=checkpoint.id)
        message = message_service.create_message(session.id, "assistant", "original", checkpoint_id=checkpoint.id)
        revision = revision_service.append_revision(message, "edited", "user", "continue")
        replayed_old_tools: list[str] = []

        class Runner:
            def run(self, graph_state, runtime_context):
                return {**graph_state, "new_output": True}

        result = ContinueService(timeline_service, checkpoint_service, RuntimeExecutor(Runner(), checkpoint_service)).continue_from_revision(
            parent_timeline_id=parent.id,
            message_id=message.id,
            revision_id=revision.id,
            checkpoint_id=checkpoint.id,
            trace_id="trace-new",
            revision_service=revision_service,
            old_tool_replayer=lambda: replayed_old_tools.append("old-tool"),
        )
        restored = checkpoint_service.restore_checkpoint(result.execution.checkpoint_id)

        self.assertEqual(replayed_old_tools, [])
        self.assertEqual(restored.timeline_id, result.timeline.id)
        self.assertEqual(timeline_service.get_timeline(parent.id).id, parent.id)


if __name__ == "__main__":
    unittest.main()
