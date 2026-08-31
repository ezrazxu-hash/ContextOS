import unittest


class AgentTestRunServiceTests(unittest.TestCase):
    def test_test_run_does_not_write_formal_session_messages(self) -> None:
        from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore

        message_service = ForbiddenMessageService()
        service = AgentTestRunService(FakeRuntime(["graph_started", "graph_finished"]), InMemoryAgentTestRunStore(), message_service=message_service)

        run = service.start(agent_version_id="agent_v1", input="hello")

        self.assertEqual(run.status, "completed")
        self.assertEqual(message_service.calls, [])

    def test_run_status_can_be_queried(self) -> None:
        from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore

        store = InMemoryAgentTestRunStore()
        service = AgentTestRunService(FakeRuntime(["graph_started", "graph_finished"]), store)

        run = service.start(agent_version_id="agent_v1", input="hello")
        loaded = service.get(run.id)

        self.assertEqual(loaded.id, run.id)
        self.assertEqual(loaded.status, "completed")
        self.assertEqual([event.type for event in loaded.events], ["graph_started", "graph_finished"])

    def test_completed_run_exposes_final_output(self) -> None:
        from contextos.api.routes.agent_test_runs import get_agent_test_run, post_agent_version_test_run
        from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore

        service = AgentTestRunService(OutputRuntime(), InMemoryAgentTestRunStore())

        created = post_agent_version_test_run("agent_v1", {"input": "hello"}, service)
        loaded = get_agent_test_run(created["body"]["id"], service)

        self.assertEqual(created["body"]["status"], "completed")
        self.assertEqual(created["body"]["output"], "final answer")
        self.assertEqual(loaded["body"]["output"], "final answer")
        self.assertEqual([event["type"] for event in loaded["body"]["events"]], ["graph_started", "node_started", "node_finished", "graph_finished"])

    def test_failed_run_status_can_be_queried(self) -> None:
        from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore

        service = AgentTestRunService(FailingRuntime(), InMemoryAgentTestRunStore())

        run = service.start(agent_version_id="agent_v1", input="hello")

        self.assertEqual(run.status, "failed")
        self.assertEqual(run.events[-1].type, "graph_failed")


class FakeRuntime:
    def __init__(self, event_types: list[str]) -> None:
        self.event_types = event_types
        self.contexts = []

    def stream_runtime_events(self, run_context):
        from contextos.runtime.agent.events import RuntimeEvent

        self.contexts.append(run_context)
        for event_type in self.event_types:
            yield RuntimeEvent(event_type, {"trace_id": run_context.trace_id})


class OutputRuntime:
    def stream_runtime_events(self, run_context):
        from contextos.runtime.agent.events import RuntimeEvent

        yield RuntimeEvent("graph_started", {"trace_id": run_context.trace_id})
        yield RuntimeEvent("node_started", {"trace_id": run_context.trace_id, "node_id": "planner"})
        yield RuntimeEvent("node_finished", {"trace_id": run_context.trace_id, "node_id": "planner"})
        yield RuntimeEvent("graph_finished", {"trace_id": run_context.trace_id, "output": "final answer"})


class FailingRuntime:
    def stream_runtime_events(self, run_context):
        del run_context
        raise RuntimeError("boom")


class ForbiddenMessageService:
    def __init__(self) -> None:
        self.calls = []

    def create_message(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        raise AssertionError("test run must not create formal messages")


if __name__ == "__main__":
    unittest.main()
