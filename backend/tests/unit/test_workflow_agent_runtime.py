import unittest


class WorkflowAgentRuntimeTests(unittest.TestCase):
    def test_loads_requested_version_and_streams_graph_events(self) -> None:
        from contextos.runtime.agent.protocol import AgentRunContext
        from contextos.runtime.agent.workflow_runtime import WorkflowAgentRuntime
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        provider = FakeProvider("runtime-ok")
        versions = AgentVersionService(InMemoryAgentVersionRepository())
        version = versions.create_published_version("research-agent", manifest_payload())
        registry = NodeExecutorRegistry()
        registry.register(LLMNodeExecutor(provider))
        registry.register(OutputNodeExecutor())

        events = list(
            WorkflowAgentRuntime(versions, registry).stream_runtime_events(
                AgentRunContext("session-1", "timeline-1", "trace-1", agent_version_id=version.id, input="hello")
            )
        )

        self.assertEqual(provider.calls, 1)
        self.assertEqual([event.type for event in events], ["graph_started", "node_started", "token", "node_finished", "node_started", "node_finished", "checkpoint", "graph_finished"])
        self.assertEqual(events[-1].data["output"], "runtime-ok")
        self.assertEqual(events[0].data["agent_version_id"], version.id)

    def test_missing_version_streams_graph_failed_event(self) -> None:
        from contextos.runtime.agent.protocol import AgentRunContext
        from contextos.runtime.agent.workflow_runtime import WorkflowAgentRuntime
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        versions = AgentVersionService(InMemoryAgentVersionRepository())

        events = list(
            WorkflowAgentRuntime(versions, NodeExecutorRegistry()).stream_runtime_events(
                AgentRunContext("session-1", "timeline-1", "trace-1", agent_version_id="missing", input="hello")
            )
        )

        self.assertEqual(events[-1].type, "graph_failed")
        self.assertEqual(events[-1].data["code"], "agent_version.not_found")

    def test_graph_error_streams_graph_failed_event(self) -> None:
        from contextos.runtime.agent.protocol import AgentRunContext
        from contextos.runtime.agent.workflow_runtime import WorkflowAgentRuntime
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        versions = AgentVersionService(InMemoryAgentVersionRepository())
        version = versions.create_published_version("research-agent", broken_manifest_payload())
        registry = NodeExecutorRegistry()
        registry.register(OutputNodeExecutor())

        events = list(
            WorkflowAgentRuntime(versions, registry).stream_runtime_events(
                AgentRunContext("session-1", "timeline-1", "trace-1", agent_version_id=version.id, input="hello")
            )
        )

        self.assertEqual(events[-1].type, "graph_failed")
        self.assertEqual(events[-1].data["code"], "output.source_missing")

    def test_compiled_graph_is_cached_by_agent_version(self) -> None:
        from contextos.runtime.agent.protocol import AgentRunContext
        from contextos.runtime.agent.workflow_runtime import WorkflowAgentRuntime
        from contextos.runtime.graph.cache import CompiledGraphCache
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        provider = FakeProvider("runtime-ok")
        versions = AgentVersionService(InMemoryAgentVersionRepository())
        version = versions.create_published_version("research-agent", manifest_payload())
        registry = NodeExecutorRegistry()
        registry.register(LLMNodeExecutor(provider))
        registry.register(OutputNodeExecutor())
        compile_service = CountingCompileService()
        runtime = WorkflowAgentRuntime(versions, registry, compile_service=compile_service, graph_cache=CompiledGraphCache())

        list(runtime.stream_runtime_events(AgentRunContext("session-1", "timeline-1", "trace-1", agent_version_id=version.id, input="hello")))
        list(runtime.stream_runtime_events(AgentRunContext("session-1", "timeline-1", "trace-2", agent_version_id=version.id, input="hello")))

        self.assertEqual(compile_service.calls, 1)

    def test_successful_workflow_emits_checkpoint_bound_to_agent_version(self) -> None:
        from contextos.runtime.agent.protocol import AgentRunContext
        from contextos.runtime.agent.workflow_runtime import WorkflowAgentRuntime
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        versions = AgentVersionService(InMemoryAgentVersionRepository())
        version = versions.create_published_version("research-agent", manifest_payload())
        registry = NodeExecutorRegistry()
        registry.register(LLMNodeExecutor(FakeProvider("runtime-ok")))
        registry.register(OutputNodeExecutor())

        events = list(
            WorkflowAgentRuntime(versions, registry).stream_runtime_events(
                AgentRunContext("session-1", "timeline-1", "trace-1", agent_version_id=version.id, input="hello")
            )
        )
        checkpoints = [event for event in events if event.type == "checkpoint"]

        self.assertEqual(len(checkpoints), 1)
        self.assertEqual(checkpoints[0].data["agent_template_id"], "research-agent")
        self.assertEqual(checkpoints[0].data["agent_version_id"], version.id)
        self.assertEqual(checkpoints[0].data["graph_state"]["output"], "runtime-ok")

    def test_run_context_message_history_is_available_in_graph_state(self) -> None:
        from contextos.runtime.agent.protocol import AgentRunContext
        from contextos.runtime.agent.workflow_runtime import WorkflowAgentRuntime
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.template.version.repository import InMemoryAgentVersionRepository
        from contextos.template.version.service import AgentVersionService

        versions = AgentVersionService(InMemoryAgentVersionRepository())
        payload = manifest_payload()
        payload["runtime"]["nodes"] = [{"id": "final", "type": "output", "config": {"source": "$state.messages"}}]
        payload["runtime"]["edges"] = [
            {"id": "start-final", "source": "START", "target": "final"},
            {"id": "final-end", "source": "final", "target": "END"},
        ]
        version = versions.create_published_version("research-agent", payload)
        registry = NodeExecutorRegistry()
        registry.register(OutputNodeExecutor())

        history = [{"role": "user", "content": "first"}, {"role": "assistant", "content": "second"}]
        events = list(
            WorkflowAgentRuntime(versions, registry).stream_runtime_events(
                AgentRunContext("session-1", "timeline-1", "trace-1", agent_version_id=version.id, input="hello", message_history=history)
            )
        )
        checkpoint = next(event for event in events if event.type == "checkpoint")

        self.assertEqual(events[-1].data["output"], history)
        self.assertEqual(checkpoint.data["graph_state"]["messages"], history)


class FakeProvider:
    def __init__(self, response: str) -> None:
        self.response = response
        self.calls = 0

    def complete(self, messages):
        del messages
        self.calls += 1
        return self.response


class CountingCompileService:
    def __init__(self) -> None:
        self.calls = 0

    def compile(self, manifest, *, node_executor_registry):
        from contextos.template.compiler.compile_service import GraphCompileService

        self.calls += 1
        return GraphCompileService().compile(manifest, node_executor_registry=node_executor_registry)


def manifest_payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "runtime": {
            "nodes": [
                {
                    "id": "planner",
                    "type": "llm",
                    "config": {
                        "model": "default",
                        "prompt_template": "{{input}}",
                        "input_mapping": {"input": "$state.input"},
                        "output_key": "answer",
                    },
                },
                {"id": "final", "type": "output", "config": {"source": "$state.answer"}},
            ],
            "edges": [
                {"id": "start-planner", "source": "START", "target": "planner"},
                {"id": "planner-final", "source": "planner", "target": "final"},
                {"id": "final-end", "source": "final", "target": "END"},
            ],
        },
        "ui": {"nodes": {}, "viewport": {}},
    }


def broken_manifest_payload() -> dict[str, object]:
    payload = manifest_payload()
    payload["runtime"]["nodes"] = [{"id": "final", "type": "output", "config": {"source": "$state.missing"}}]
    payload["runtime"]["edges"] = [
        {"id": "start-final", "source": "START", "target": "final"},
        {"id": "final-end", "source": "final", "target": "END"},
    ]
    return payload


if __name__ == "__main__":
    unittest.main()
