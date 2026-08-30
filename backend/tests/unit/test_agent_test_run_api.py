import unittest


class AgentTestRunApiTests(unittest.TestCase):
    def test_create_test_run_returns_run_id(self) -> None:
        from contextos.api.routes.agent_test_runs import post_agent_version_test_run
        from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore

        service = AgentTestRunService(FakeRuntime(["graph_started", "graph_finished"]), InMemoryAgentTestRunStore())

        response = post_agent_version_test_run("agent_v1", {"input": "hello"}, service)

        self.assertEqual(response["status"], 201)
        self.assertTrue(str(response["body"]["run_id"]).startswith("test_run_"))
        self.assertEqual(response["body"]["status"], "completed")

    def test_sse_frames_use_runtime_event_contract(self) -> None:
        from contextos.api.routes.agent_test_runs import iter_agent_test_run_event_frames
        from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore

        service = AgentTestRunService(FakeRuntime(["graph_started", "token", "graph_finished"]), InMemoryAgentTestRunStore())
        response = service.start(agent_version_id="agent_v1", input="hello")

        frames = list(iter_agent_test_run_event_frames(response.id, service))

        self.assertTrue(frames[0].startswith("event: graph_started\n"))
        self.assertTrue(frames[1].startswith("event: token\n"))
        self.assertTrue(frames[2].startswith("event: graph_finished\n"))

    def test_run_status_can_be_returned_after_completion(self) -> None:
        from contextos.api.routes.agent_test_runs import get_agent_test_run
        from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore

        service = AgentTestRunService(FakeRuntime(["graph_started", "graph_finished"]), InMemoryAgentTestRunStore())
        run = service.start(agent_version_id="agent_v1", input="hello")

        response = get_agent_test_run(run.id, service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["status"], "completed")
        self.assertEqual([event["type"] for event in response["body"]["events"]], ["graph_started", "graph_finished"])


class FakeRuntime:
    def __init__(self, event_types: list[str]) -> None:
        self.event_types = event_types

    def stream_runtime_events(self, run_context):
        from contextos.runtime.agent.events import RuntimeEvent

        for event_type in self.event_types:
            data = {"trace_id": run_context.trace_id}
            if event_type == "token":
                data["content"] = "ok"
            yield RuntimeEvent(event_type, data)


if __name__ == "__main__":
    unittest.main()
