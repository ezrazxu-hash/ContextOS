from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class TimelineApiTests(unittest.TestCase):
    def create_services(self):
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService

        session_repository = InMemorySessionRepository()
        session_service = SessionService(session_repository)
        timeline_service = TimelineService(InMemoryTimelineRepository(), session_repository)
        return session_service, timeline_service

    def test_fork_records_parent_checkpoint_and_message(self) -> None:
        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        parent = timeline_service.create_initial_timeline(session.id)

        child = timeline_service.fork_timeline(
            parent_timeline_id=parent.id,
            fork_checkpoint_id="checkpoint-1",
            fork_message_id="message-1",
        )

        self.assertEqual(child.session_id, session.id)
        self.assertEqual(child.parent_timeline_id, parent.id)
        self.assertEqual(child.fork_checkpoint_id, "checkpoint-1")
        self.assertEqual(child.fork_message_id, "message-1")

    def test_activate_timeline_updates_session_pointer(self) -> None:
        from contextos.api.routes.timelines import activate_timeline

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        parent = timeline_service.create_initial_timeline(session.id)
        child = timeline_service.fork_timeline(parent.id, "checkpoint-1", "message-1")

        response = activate_timeline(child.id, timeline_service)
        loaded_session = session_service.get_session(session.id)

        self.assertEqual(response["status"], 200)
        self.assertEqual(loaded_session.current_timeline_id, child.id)

    def test_original_timeline_remains_readable_after_fork_and_activation(self) -> None:
        from contextos.api.routes.timelines import get_timeline, list_session_timelines

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        parent = timeline_service.create_initial_timeline(session.id)
        child = timeline_service.fork_timeline(parent.id, "checkpoint-1", "message-1")
        timeline_service.activate_timeline(child.id)

        parent_response = get_timeline(parent.id, timeline_service)
        listed = list_session_timelines(session.id, timeline_service)

        self.assertEqual(parent_response["status"], 200)
        self.assertEqual(parent_response["body"]["id"], parent.id)
        self.assertEqual(parent_response["body"]["parent_timeline_id"], None)
        self.assertEqual([timeline["id"] for timeline in listed["body"]], [parent.id, child.id])

    def test_delete_non_current_timeline_hides_it_and_keeps_current(self) -> None:
        from contextos.api.routes.timelines import remove_timeline, list_session_timelines

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        current = timeline_service.create_initial_timeline(session.id)
        deleted = timeline_service.fork_timeline(current.id, "checkpoint-1", "message-1")
        kept = timeline_service.fork_timeline(current.id, "checkpoint-2", "message-2")

        response = remove_timeline(deleted.id, timeline_service)
        listed = list_session_timelines(session.id, timeline_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["current_timeline_id"], current.id)
        self.assertEqual(session_service.get_session(session.id).current_timeline_id, current.id)
        self.assertEqual([timeline["id"] for timeline in listed["body"]], [current.id, kept.id])

    def test_delete_current_timeline_selects_adjacent_timeline(self) -> None:
        from contextos.api.routes.timelines import remove_timeline, list_session_timelines

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        first = timeline_service.create_initial_timeline(session.id)
        current = timeline_service.fork_timeline(first.id, "checkpoint-1", "message-1")
        next_timeline = timeline_service.fork_timeline(first.id, "checkpoint-2", "message-2")
        timeline_service.activate_timeline(current.id)

        response = remove_timeline(current.id, timeline_service)
        listed = list_session_timelines(session.id, timeline_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["current_timeline_id"], next_timeline.id)
        self.assertEqual(session_service.get_session(session.id).current_timeline_id, next_timeline.id)
        self.assertEqual([timeline["id"] for timeline in listed["body"]], [first.id, next_timeline.id])

    def test_delete_only_timeline_clears_session_current_pointer(self) -> None:
        from contextos.api.routes.timelines import remove_timeline, list_session_timelines

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        only = timeline_service.create_initial_timeline(session.id)

        response = remove_timeline(only.id, timeline_service)
        listed = list_session_timelines(session.id, timeline_service)

        self.assertEqual(response["status"], 200)
        self.assertIsNone(response["body"]["current_timeline_id"])
        self.assertIsNone(session_service.get_session(session.id).current_timeline_id)
        self.assertEqual(listed["body"], [])

    def test_delete_parent_timeline_keeps_child_readable(self) -> None:
        from contextos.api.routes.timelines import remove_timeline, get_timeline, list_session_timelines

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        parent = timeline_service.create_initial_timeline(session.id)
        child = timeline_service.fork_timeline(parent.id, "checkpoint-1", "message-1")
        timeline_service.activate_timeline(child.id)

        response = remove_timeline(parent.id, timeline_service)
        child_response = get_timeline(child.id, timeline_service)
        listed = list_session_timelines(session.id, timeline_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(session_service.get_session(session.id).current_timeline_id, child.id)
        self.assertEqual(child_response["status"], 200)
        self.assertEqual(child_response["body"]["parent_timeline_id"], parent.id)
        self.assertEqual([timeline["id"] for timeline in listed["body"]], [child.id])

    def test_patch_timeline_title_preserves_identity_parent_and_current(self) -> None:
        from contextos.api.routes.timelines import patch_timeline

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        parent = timeline_service.create_initial_timeline(session.id)
        child = timeline_service.fork_timeline(parent.id, "checkpoint-1", "message-1")
        timeline_service.activate_timeline(child.id)

        response = patch_timeline(child.id, {"title": "  Before Edit  "}, timeline_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["id"], child.id)
        self.assertEqual(response["body"]["title"], "Before Edit")
        self.assertEqual(response["body"]["parent_timeline_id"], parent.id)
        self.assertEqual(response["body"]["fork_checkpoint_id"], "checkpoint-1")
        self.assertEqual(response["body"]["fork_message_id"], "message-1")
        self.assertEqual(session_service.get_session(session.id).current_timeline_id, child.id)

    def test_patch_timeline_rejects_blank_title(self) -> None:
        from contextos.api.routes.timelines import patch_timeline

        session_service, timeline_service = self.create_services()
        session = session_service.create_session(agent_template_id="research-agent")
        timeline = timeline_service.create_initial_timeline(session.id)

        response = patch_timeline(timeline.id, {"title": "   "}, timeline_service)

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["body"]["error"]["code"], "timeline.invalid_title")


if __name__ == "__main__":
    unittest.main()
