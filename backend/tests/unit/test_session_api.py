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


if __name__ == "__main__":
    unittest.main()
