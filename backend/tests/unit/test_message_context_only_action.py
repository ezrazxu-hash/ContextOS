import unittest


class MessageContextOnlyActionTests(unittest.TestCase):
    def create_services(self):
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.session.message_revision_service import MessageRevisionService
        from contextos.runtime.session.message_service import MessageService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService

        session_repository = InMemorySessionRepository()
        session_service = SessionService(session_repository)
        timeline_service = TimelineService(InMemoryTimelineRepository(), session_repository)
        message_service = MessageService()
        revision_service = MessageRevisionService()
        return session_service, timeline_service, message_service, revision_service

    def test_context_only_edit_creates_one_new_timeline_without_running_agent(self) -> None:
        from contextos.api.routes.message_actions import post_message_context_only

        session_service, timeline_service, message_service, revision_service = self.create_services()
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

        session_service, timeline_service, message_service, revision_service = self.create_services()
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


if __name__ == "__main__":
    unittest.main()
