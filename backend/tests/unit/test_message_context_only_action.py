import unittest


class MessageContextOnlyActionTests(unittest.TestCase):
    def create_services(self):
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.session.message_revision_service import MessageRevisionService
        from contextos.runtime.session.message_service import MessageService
        from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
        from contextos.runtime.conversation.service import ConversationGroupService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService

        session_repository = InMemorySessionRepository()
        session_service = SessionService(session_repository)
        timeline_service = TimelineService(InMemoryTimelineRepository(), session_repository)
        message_service = MessageService()
        revision_service = MessageRevisionService()
        group_service = ConversationGroupService(InMemoryConversationGroupRepository())
        return session_service, timeline_service, message_service, revision_service, group_service

    def test_context_only_edit_creates_one_new_timeline_without_running_agent(self) -> None:
        from contextos.api.routes.message_actions import post_message_context_only

        session_service, timeline_service, message_service, revision_service, _group_service = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        message = message_service.create_message(session.id, "assistant", "original", checkpoint_id="checkpoint-1")
        revision = revision_service.append_revision(message, "edited", "user", "context only")
        agent_runs: list[str] = []

        response = post_message_context_only(
            message.id,
            {"parent_timeline_id": parent.id, "revision_id": revision.id},
            timeline_service,
            message_service,
            revision_service,
            agent_runner=lambda: agent_runs.append("ran"),
        )

        timelines = timeline_service.list_timelines(session.id)
        self.assertEqual(response["status"], 200)
        self.assertEqual(len(timelines), 2)
        self.assertEqual(response["body"]["timeline"]["parent_timeline_id"], parent.id)
        self.assertEqual(agent_runs, [])

    def test_new_working_context_uses_edited_version_and_excludes_old_future_messages(self) -> None:
        from contextos.api.routes.message_actions import post_message_context_only

        session_service, timeline_service, message_service, revision_service, _group_service = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)
        message = message_service.create_message(session.id, "assistant", "original", checkpoint_id="checkpoint-1")
        message_service.create_message(session.id, "assistant", "old future", checkpoint_id="checkpoint-2")
        revision = revision_service.append_revision(message, "edited", "user", "context only")

        response = post_message_context_only(
            message.id,
            {"parent_timeline_id": parent.id, "revision_id": revision.id},
            timeline_service,
            message_service,
            revision_service,
        )

        self.assertEqual(
            response["body"]["working_context_messages"],
            [{"message_id": message.id, "content": "edited"}],
        )
        all_messages, _ = message_service.list_messages(session.id)
        self.assertEqual([item.content for item in all_messages], ["original", "old future"])
        self.assertEqual(timeline_service.get_timeline(parent.id).id, parent.id)

    def test_user_context_only_edit_forks_timeline_with_prefix_and_edited_user_only(self) -> None:
        from contextos.api.routes.message_actions import post_message_context_only
        from contextos.runtime.conversation.context_builder import ConversationContextBuilder

        session_service, timeline_service, message_service, revision_service, group_service = self.create_services()
        session = session_service.create_session("agent")
        parent = timeline_service.create_initial_timeline(session.id)

        group1 = group_service.start_turn(session.id, parent.id, "user-1", group_id="group-1")
        message_service.create_message(session.id, "user", "before user", timeline_id=parent.id, group_id=group1.id, context_group_ids=[group1.id], message_id="user-1")
        message_service.create_message(session.id, "assistant", "before assistant", timeline_id=parent.id, group_id=group1.id, context_group_ids=[group1.id], message_id="assistant-1")
        group_service.append_message(group1.id, "assistant-1")

        group2 = group_service.start_turn(session.id, parent.id, "user-2", group_id="group-2")
        user = message_service.create_message(session.id, "user", "old user", timeline_id=parent.id, group_id=group2.id, context_group_ids=[group2.id], message_id="user-2")
        message_service.create_message(
            session.id,
            "assistant",
            "old tool future",
            timeline_id=parent.id,
            group_id=group2.id,
            context_group_ids=[group2.id],
            tool_call_ids=["call-old"],
            tool_result_ids=["call-old"],
            message_id="assistant-tool-old",
        )
        group_service.append_message(group2.id, "assistant-tool-old")
        revision = revision_service.append_revision(user, "edited user", "user", "context only")

        response = post_message_context_only(
            user.id,
            {"parent_timeline_id": parent.id, "revision_id": revision.id},
            timeline_service,
            message_service,
            revision_service,
            conversation_group_service=group_service,
        )

        child_id = response["body"]["timeline"]["id"]
        self.assertEqual(len(timeline_service.list_timelines(session.id)), 2)
        self.assertEqual(session_service.get_session(session.id).current_timeline_id, child_id)
        self.assertEqual([message.content for message in message_service.list_messages(session.id, timeline_id=parent.id)[0]], ["before user", "before assistant", "old user", "old tool future"])
        self.assertEqual(
            [message["content"] for message in ConversationContextBuilder(group_service._repository, message_service).build_llm_messages(session.id, child_id)],
            ["before user", "before assistant", "edited user"],
        )
        child_messages = message_service.list_messages(session.id, timeline_id=child_id)[0]
        self.assertNotIn("old tool future", [message.content for message in child_messages])
        self.assertFalse(any(message.tool_call_ids or message.tool_result_ids for message in child_messages if message.content == "edited user"))


if __name__ == "__main__":
    unittest.main()
