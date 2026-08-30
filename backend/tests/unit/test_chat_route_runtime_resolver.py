from datetime import datetime, timezone
import unittest


class ChatRouteRuntimeResolverTests(unittest.TestCase):
    def test_chat_runtime_events_resolve_runtime_once_and_keep_legacy_event_shape(self) -> None:
        from contextos.api.server import _chat_runtime_events
        from contextos.runtime.agent.events import RuntimeEvent
        from contextos.runtime.session.model import Session, SessionStatus

        session = Session(
            id="session-1",
            workspace_id="workspace-1",
            agent_template_id="research-agent",
            current_timeline_id="timeline-1",
            created_at=datetime(2026, 8, 30, tzinfo=timezone.utc),
            status=SessionStatus.ACTIVE,
        )

        class SessionRepository:
            def get(self, session_id: str):
                return session if session_id == "session-1" else None

        class Runtime:
            def __init__(self) -> None:
                self.contexts = []

            def stream_runtime_events(self, run_context):
                self.contexts.append(run_context)
                yield RuntimeEvent(type="token", data={"content": "OK"})
                yield RuntimeEvent(type="graph_finished", data={"message_id": "message-1"})

        class Resolver:
            def __init__(self, runtime: Runtime) -> None:
                self.runtime = runtime
                self.sessions = []

            def resolve(self, resolved_session):
                self.sessions.append(resolved_session)
                return self.runtime

        class Services:
            def __init__(self) -> None:
                self.session_repository = SessionRepository()
                self.runtime = Runtime()
                self.agent_runtime_resolver = Resolver(self.runtime)

        services = Services()

        events = list(_chat_runtime_events("session-1", "timeline-1", services))

        self.assertEqual(events, [
            {"type": "token", "data": {"content": "OK"}},
            {"type": "done", "data": {"message_id": "message-1"}},
        ])
        self.assertEqual(services.agent_runtime_resolver.sessions, [session])
        self.assertEqual(len(services.runtime.contexts), 1)
        self.assertEqual(services.runtime.contexts[0].session_id, "session-1")
        self.assertEqual(services.runtime.contexts[0].timeline_id, "timeline-1")
        self.assertEqual(services.runtime.contexts[0].trace_id, "trace-chat-response")


if __name__ == "__main__":
    unittest.main()
