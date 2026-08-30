import unittest


class WorkflowSliceLlmTests(unittest.TestCase):
    def test_json_manifest_runs_start_prompt_llm_output_end(self) -> None:
        from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.nodes.prompt import PromptNodeExecutor
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.compile_service import GraphCompileService
        from contextos.template.extension.registry import ExtensionRegistry
        from contextos.template.manifest.parser import parse_manifest
        from contextos.template.validator.validator import ManifestValidator
        from contextos.tool.registry.registry import ToolRegistry

        provider = FakeProvider("slice-ok")
        registry = NodeExecutorRegistry()
        registry.register(PromptNodeExecutor())
        registry.register(LLMNodeExecutor(provider))
        registry.register(OutputNodeExecutor())
        manifest = parse_manifest(manifest_payload())

        validation = ManifestValidator(ExtensionRegistry(), ToolRegistry()).validate_result(manifest)
        self.assertTrue(validation.valid, validation.errors)

        graph = GraphCompileService().compile(manifest, node_executor_registry=registry)
        state = graph.run(
            {
                "session_id": "session-1",
                "timeline_id": "timeline-1",
                "run_id": "run-1",
                "input": "hello",
            },
            RuntimeContext("session-1", "timeline-1", "trace-1"),
        )

        self.assertEqual(provider.calls, 1)
        self.assertEqual(provider.messages[0][-1]["content"], "Question: hello")
        self.assertEqual(state["visited_nodes"], ["compose_prompt", "planner", "final"])
        self.assertEqual(state["output"], "slice-ok")
        self.assertEqual(
            [event["type"] for event in state["runtime_events"]],
            ["node_started", "node_finished", "node_started", "token", "node_finished", "node_started", "node_finished"],
        )
        self.assertEqual(
            [event["data"]["node_id"] for event in state["runtime_events"]],
            ["compose_prompt", "compose_prompt", "planner", "planner", "planner", "final", "final"],
        )


class FakeProvider:
    def __init__(self, response: str) -> None:
        self.response = response
        self.calls = 0
        self.messages = []

    def complete(self, messages):
        self.calls += 1
        self.messages.append(messages)
        return self.response


def manifest_payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "runtime": {
            "nodes": [
                {
                    "id": "compose_prompt",
                    "type": "prompt",
                    "config": {
                        "template": "Question: {{input}}",
                        "input_mapping": {"input": "$state.input"},
                        "output_key": "prompt_text",
                    },
                },
                {
                    "id": "planner",
                    "type": "llm",
                    "config": {
                        "model": "default",
                        "prompt": "{{prompt}}",
                        "input_mapping": {"prompt": "$state.prompt_text"},
                        "output_key": "answer",
                    },
                },
                {"id": "final", "type": "output", "config": {"source": "$state.answer"}},
            ],
            "edges": [
                {"id": "start-compose", "source": "START", "target": "compose_prompt"},
                {"id": "compose-planner", "source": "compose_prompt", "target": "planner"},
                {"id": "planner-final", "source": "planner", "target": "final"},
                {"id": "final-end", "source": "final", "target": "END"},
            ],
        },
        "ui": {"nodes": {}, "viewport": {}},
    }


if __name__ == "__main__":
    unittest.main()
