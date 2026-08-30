import unittest


class SessionAgentSwitchGuardTests(unittest.TestCase):
    def test_busy_statuses_reject_agent_switch(self) -> None:
        from contextos.api.routes.sessions import patch_session_agent
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.run_status import SessionRunStatusService
        from contextos.runtime.session.service import SessionService

        for status in ["generating", "unfinished_tool", "interrupt", "replay"]:
            with self.subTest(status=status):
                session_service = SessionService(InMemorySessionRepository())
                session = session_service.create_session("research-agent")
                run_status = SessionRunStatusService()
                run_status.set_status(session.id, status)

                response = patch_session_agent(session.id, {"agent_version_id": None}, session_service, None, run_status_service=run_status)

                self.assertEqual(response["status"], 409)
                self.assertEqual(response["body"]["error"]["code"], f"session.agent_switch_blocked.{status}")

    def test_idle_session_can_switch_agent(self) -> None:
        from contextos.api.routes.sessions import patch_session_agent
        from contextos.runtime.session.repository import InMemorySessionRepository
        from contextos.runtime.session.run_status import SessionRunStatusService
        from contextos.runtime.session.service import SessionService

        session_service = SessionService(InMemorySessionRepository())
        session = session_service.create_session("research-agent", agent_version_id="research-agent_v1")
        run_status = SessionRunStatusService()
        run_status.set_status(session.id, "idle")

        response = patch_session_agent(session.id, {"agent_version_id": None}, session_service, None, run_status_service=run_status)

        self.assertEqual(response["status"], 200)
        self.assertIsNone(response["body"]["agent_version_id"])


if __name__ == "__main__":
    unittest.main()
