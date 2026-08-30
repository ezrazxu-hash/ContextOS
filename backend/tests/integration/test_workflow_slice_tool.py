import unittest


class WorkflowSliceToolTests(unittest.TestCase):
    def test_llm_output_flows_through_tool_to_output(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.runtime.graph.nodes.tool import ToolNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.compile_service import GraphCompileService
        from contextos.template.extension.registry import ExtensionRegistry
        from contextos.template.manifest.parser import parse_manifest
        from contextos.template.validator.validator import ManifestValidator
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry

        provider = FakeProvider("lookup-key")
        tool = FakeTool()
        tool_registry = ToolExecutorRegistry([ToolExecutor("context.echo", tool.run, required_args=("query",))])
        node_registry = NodeExecutorRegistry()
        node_registry.register(LLMNodeExecutor(provider))
        node_registry.register(ToolNodeExecutor(tool_registry))
        node_registry.register(OutputNodeExecutor())
        manifest = parse_manifest(manifest_payload())

        validation = ManifestValidator(
            ExtensionRegistry(),
            ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ, idempotent=True)]),
        ).validate_result(manifest)
        self.assertTrue(validation.valid, validation.errors)

        state = GraphCompileService().compile(manifest, node_executor_registry=node_registry).run(
            {
                "session_id": "session-1",
                "timeline_id": "timeline-1",
                "run_id": "run-1",
                "input": "hello",
            },
            RuntimeContext("session-1", "timeline-1", "trace-1"),
        )

        self.assertEqual(provider.calls, 1)
        self.assertEqual(tool.calls, [{"query": "lookup-key"}])
        self.assertEqual(state["visited_nodes"], ["planner", "lookup", "final"])
        self.assertEqual(state["output"], {"echo": "lookup-key"})
        self.assertEqual(
            [event["type"] for event in state["runtime_events"]],
            [
                "node_started",
                "token",
                "node_finished",
                "tool_call",
                "tool_result",
                "node_started",
                "node_finished",
            ],
        )


class FakeProvider:
    def __init__(self, response: str) -> None:
        self.response = response
        self.calls = 0

    def complete(self, messages):
        del messages
        self.calls += 1
        return self.response


class FakeTool:
    def __init__(self) -> None:
        self.calls = []

    async def run(self, args):
        self.calls.append(args)
        return {"echo": args["query"]}


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
                {
                    "id": "lookup",
                    "type": "tool",
                    "config": {
                        "tool_name": "context.echo",
                        "args": {"query": "$state.answer"},
                        "output_key": "lookup_result",
                    },
                },
                {"id": "final", "type": "output", "config": {"source": "$state.lookup_result"}},
            ],
            "edges": [
                {"id": "start-planner", "source": "START", "target": "planner"},
                {"id": "planner-lookup", "source": "planner", "target": "lookup"},
                {"id": "lookup-final", "source": "lookup", "target": "final"},
                {"id": "final-end", "source": "final", "target": "END"},
            ],
        },
        "ui": {"nodes": {}, "viewport": {}},
    }


if __name__ == "__main__":
    unittest.main()
