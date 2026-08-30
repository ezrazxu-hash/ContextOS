from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class SessionApiTests(unittest.TestCase):
    def test_created_session_can_be_read_with_matching_fields(self) -> None:
        from contextos.api.routes.sessions import get_session, post_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        service = SessionService(InMemorySessionRepository())

        created = post_session({"agent_template_id": "research-agent"}, service)
        loaded = get_session(created["body"]["id"], service)

        self.assertEqual(created["status"], 201)
        self.assertEqual(loaded["status"], 200)
        self.assertEqual(loaded["body"]["id"], created["body"]["id"])
        self.assertEqual(loaded["body"]["workspace_id"], None)
        self.assertEqual(loaded["body"]["agent_template_id"], "research-agent")
        self.assertEqual(loaded["body"]["current_timeline_id"], None)
        self.assertEqual(loaded["body"]["status"], "active")
        self.assertIsInstance(loaded["body"]["created_at"], str)

    def test_missing_session_returns_stable_404_payload(self) -> None:
        from contextos.api.routes.sessions import get_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        response = get_session("missing-session", SessionService(InMemorySessionRepository()), request_id="req-404")

        self.assertEqual(response["status"], 404)
        self.assertEqual(
            response["body"],
            {
                "error": {
                    "code": "session.not_found",
                    "message": "Session not found",
                    "request_id": "req-404",
                    "status": 404,
                }
            },
        )

    def test_empty_workspace_id_is_reserved_and_does_not_trigger_tenant_logic(self) -> None:
        from contextos.api.routes.sessions import post_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        response = post_session({"agent_template_id": "research-agent", "workspace_id": None}, SessionService(InMemorySessionRepository()))

        self.assertEqual(response["status"], 201)
        self.assertEqual(response["body"]["workspace_id"], None)
        self.assertNotIn("tenant", response["body"])
        self.assertIsNone(response["body"]["agent_version_id"])

    def test_session_can_store_nullable_agent_version_id(self) -> None:
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        service = SessionService(InMemorySessionRepository())

        legacy = service.create_session("research-agent")
        workflow = service.create_session("research-agent", agent_version_id="research-agent_v1")

        self.assertIsNone(legacy.agent_version_id)
        self.assertEqual(workflow.agent_version_id, "research-agent_v1")
        self.assertEqual(workflow.to_dict()["agent_version_id"], "research-agent_v1")

    def test_create_session_can_bind_published_agent_version(self) -> None:
        from contextos.api.routes.sessions import post_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        version_service = AgentVersionService(InMemoryAgentVersionRepository())
        version = version_service.create_published_version("research-agent", {"schema_version": "1.0"})

        response = post_session(
            {"agent_template_id": "research-agent", "agent_version_id": version.id},
            SessionService(InMemorySessionRepository()),
            agent_version_service=version_service,
        )

        self.assertEqual(response["status"], 201)
        self.assertEqual(response["body"]["agent_version_id"], version.id)

    def test_create_session_rejects_unpublished_agent_version(self) -> None:
        from contextos.api.routes.sessions import post_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        response = post_session(
            {"agent_template_id": "research-agent", "agent_version_id": "draft-version"},
            SessionService(InMemorySessionRepository()),
            agent_version_service=FakeVersionService(FakeVersion("draft-version", "research-agent", "draft")),
        )

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["body"]["error"]["code"], "agent_version.not_published")

    def test_create_session_rejects_template_version_mismatch(self) -> None:
        from contextos.api.routes.sessions import post_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        version_service = AgentVersionService(InMemoryAgentVersionRepository())
        version = version_service.create_published_version("other-agent", {"schema_version": "1.0"})

        response = post_session(
            {"agent_template_id": "research-agent", "agent_version_id": version.id},
            SessionService(InMemorySessionRepository()),
            agent_version_service=version_service,
        )

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["body"]["error"]["code"], "agent_version.template_mismatch")

    def test_switch_session_agent_version_v1_to_v2(self) -> None:
        from contextos.api.routes.sessions import patch_session_agent
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        session_service = SessionService(InMemorySessionRepository())
        version_service = AgentVersionService(InMemoryAgentVersionRepository())
        v1 = version_service.create_published_version("research-agent", {"schema_version": "1.0", "version": 1})
        v2 = version_service.create_published_version("research-agent", {"schema_version": "1.0", "version": 2})
        session = session_service.create_session("research-agent", agent_version_id=v1.id)

        response = patch_session_agent(session.id, {"agent_version_id": v2.id}, session_service, version_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["agent_version_id"], v2.id)
        self.assertEqual(session_service.get_session(session.id).agent_version_id, v2.id)

    def test_switch_session_agent_version_to_legacy(self) -> None:
        from contextos.api.routes.sessions import patch_session_agent
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        session_service = SessionService(InMemorySessionRepository())
        session = session_service.create_session("research-agent", agent_version_id="research-agent_v1")

        response = patch_session_agent(session.id, {"agent_version_id": None}, session_service, None)

        self.assertEqual(response["status"], 200)
        self.assertIsNone(response["body"]["agent_version_id"])

    def test_switch_session_agent_rejects_draft(self) -> None:
        from contextos.api.routes.sessions import patch_session_agent
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        session_service = SessionService(InMemorySessionRepository())
        session = session_service.create_session("research-agent")

        response = patch_session_agent(
            session.id,
            {"agent_version_id": "draft-version"},
            session_service,
            FakeVersionService(FakeVersion("draft-version", "research-agent", "draft")),
        )

        self.assertEqual(response["status"], 400)
        self.assertEqual(response["body"]["error"]["code"], "agent_version.not_published")

    def test_switch_session_agent_does_not_rewrite_history(self) -> None:
        from contextos.api.routes.sessions import patch_session_agent
        from contextos.runtime.session.message_service import MessageService
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        session_service = SessionService(InMemorySessionRepository())
        message_service = MessageService()
        session = session_service.create_session("research-agent", agent_version_id="research-agent_v1")
        message = message_service.create_message(session.id, "user", "history", timeline_id="timeline-1")

        patch_session_agent(session.id, {"agent_version_id": None}, session_service, None)

        messages, _ = message_service.list_messages(session.id, timeline_id="timeline-1")
        self.assertEqual([item.id for item in messages], [message.id])
        self.assertEqual(messages[0].content, "history")

    def test_session_title_update_does_not_create_timeline(self) -> None:
        from contextos.api.routes.sessions import patch_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService
        from contextos.runtime.timeline.repository import InMemoryTimelineRepository
        from contextos.runtime.timeline.service import TimelineService

        session_repository = InMemorySessionRepository()
        session_service = SessionService(session_repository)
        timeline_service = TimelineService(InMemoryTimelineRepository(), session_repository)
        session = session_service.create_session("research-agent")
        timeline_service.create_initial_timeline(session.id)

        response = patch_session(session.id, {"title": "Renamed session"}, session_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["title"], "Renamed session")
        self.assertEqual(len(timeline_service.list_timelines(session.id)), 1)

    def test_session_title_update_trims_and_rejects_blank_title(self) -> None:
        from contextos.api.routes.sessions import patch_session
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.service import SessionService

        session_service = SessionService(InMemorySessionRepository())
        session = session_service.create_session("research-agent", title="Original")

        trimmed = patch_session(session.id, {"title": "  Project Chat  "}, session_service)
        blank = patch_session(session.id, {"title": "   "}, session_service)

        self.assertEqual(trimmed["status"], 200)
        self.assertEqual(trimmed["body"]["title"], "Project Chat")
        self.assertEqual(blank["status"], 400)
        self.assertEqual(blank["body"]["error"]["code"], "session.invalid_title")
        self.assertEqual(session_service.get_session(session.id).title, "Project Chat")


class FakeVersion:
    def __init__(self, id: str, agent_template_id: str, status: str) -> None:
        self.id = id
        self.agent_template_id = agent_template_id
        self.status = status


class FakeVersionService:
    def __init__(self, version: FakeVersion) -> None:
        self.version = version

    def get_version(self, version_id: str) -> FakeVersion:
        if version_id != self.version.id:
            raise KeyError(version_id)
        return self.version


if __name__ == "__main__":
    unittest.main()
