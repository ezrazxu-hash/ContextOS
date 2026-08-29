import unittest


class ContinueFromMessageRevisionTests(unittest.TestCase):
    def create_services(self):
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
        from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
        from contextos.runtime.conversation.service import ConversationGroupService
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
            ConversationGroupService(InMemoryConversationGroupRepository()),
        )

    def test_continues_from_message_checkpoint_with_revision_applied(self) -> None:
        from contextos.runtime.graph.executor import RuntimeExecutor
        from contextos.runtime.timeline.continue_service import ContinueService

        session_service, timeline_service, checkpoint_service, message_service, revision_service, _group_service = self.create_services()
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

        session_service, timeline_service, checkpoint_service, message_service, revision_service, _group_service = self.create_services()
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

    def test_user_continue_forks_with_edited_user_and_excludes_old_future_tool_messages(self) -> None:
        from contextos.runtime.conversation.context_builder import ConversationContextBuilder
        from contextos.runtime.graph.executor import RuntimeExecutor
        from contextos.runtime.timeline.continue_service import ContinueService

        session_service, timeline_service, checkpoint_service, message_service, revision_service, group_service = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        checkpoint = checkpoint_service.save_checkpoint(session.id, parent.id, {"step": "before-edit"}, 2, "ctx-1")

        group1 = group_service.start_turn(session.id, parent.id, "user-1", group_id="group-1")
        message_service.create_message(session.id, "user", "prefix user", timeline_id=parent.id, group_id=group1.id, context_group_ids=[group1.id], message_id="user-1")
        message_service.create_message(session.id, "assistant", "prefix assistant", timeline_id=parent.id, group_id=group1.id, context_group_ids=[group1.id], message_id="assistant-1")
        group_service.append_message(group1.id, "assistant-1")

        group2 = group_service.start_turn(session.id, parent.id, "user-2", group_id="group-2")
        user = message_service.create_message(session.id, "user", "old user", timeline_id=parent.id, group_id=group2.id, context_group_ids=[group2.id], checkpoint_id=checkpoint.id, message_id="user-2")
        message_service.create_message(
            session.id,
            "assistant",
            "old tool answer",
            timeline_id=parent.id,
            group_id=group2.id,
            context_group_ids=[group2.id],
            tool_call_ids=["call-old"],
            tool_result_ids=["call-old"],
            message_id="assistant-tool-old",
        )
        group_service.append_message(group2.id, "assistant-tool-old")
        revision = revision_service.append_revision(user, "edited user", "user", "continue")

        class Runner:
            def run(self, graph_state, runtime_context):
                return {**graph_state, "continued": True}

        result = ContinueService(
            timeline_service,
            checkpoint_service,
            RuntimeExecutor(Runner(), checkpoint_service),
            message_service,
            group_service,
        ).continue_from_revision(
            parent_timeline_id=parent.id,
            message_id=user.id,
            revision_id=revision.id,
            checkpoint_id=checkpoint.id,
            trace_id="trace-new",
            revision_service=revision_service,
        )

        self.assertEqual(session_service.get_session(session.id).current_timeline_id, result.timeline.id)
        self.assertEqual(
            [message["content"] for message in ConversationContextBuilder(group_service._repository, message_service).build_llm_messages(session.id, result.timeline.id)],
            ["prefix user", "prefix assistant", "edited user"],
        )
        child_messages = message_service.list_messages(session.id, timeline_id=result.timeline.id)[0]
        self.assertNotIn("old tool answer", [message.content for message in child_messages])
        self.assertFalse(any(message.tool_call_ids or message.tool_result_ids for message in child_messages if message.content == "edited user"))


if __name__ == "__main__":
    unittest.main()
