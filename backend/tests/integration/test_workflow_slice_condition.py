import unittest


class WorkflowSliceConditionTests(unittest.TestCase):
    def test_true_branch_only_executes_true_llm(self) -> None:
        state = run_slice(["yes", "true-answer"])

        self.assertEqual(state["visited_nodes"], ["compose_prompt", "classifier", "lookup", "check", "answer_yes", "final"])
        self.assertEqual(state["output"], "true-answer")
        self.assertNotIn("answer_no", [event["data"]["node_id"] for event in state["runtime_events"]])

    def test_false_branch_only_executes_false_llm(self) -> None:
        state = run_slice(["no", "false-answer"])

        self.assertEqual(state["visited_nodes"], ["compose_prompt", "classifier", "lookup", "check", "answer_no", "final"])
        self.assertEqual(state["output"], "false-answer")
        self.assertNotIn("answer_yes", [event["data"]["node_id"] for event in state["runtime_events"]])


def run_slice(responses: list[str]) -> dict[str, object]:
    from contextos.runtime.graph.nodes.condition import ConditionNodeExecutor
    from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
    from contextos.runtime.graph.nodes.output import OutputNodeExecutor
    from contextos.runtime.graph.nodes.prompt import PromptNodeExecutor
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

    provider = SequenceProvider(responses)
    tool = IntentTool()
    registry = NodeExecutorRegistry()
    registry.register(PromptNodeExecutor())
    registry.register(LLMNodeExecutor(provider))
    registry.register(ToolNodeExecutor(ToolExecutorRegistry([ToolExecutor("intent.lookup", tool.run, required_args=("intent",))])))
    registry.register(ConditionNodeExecutor())
    registry.register(OutputNodeExecutor())
    manifest = parse_manifest(manifest_payload())

    tool_registry = ToolRegistry([ToolMetadata(tool_id="intent.lookup", name="Intent Lookup", side_effect=SideEffect.READ, idempotent=True)])
    validation = ManifestValidator(ExtensionRegistry(), tool_registry).validate_result(manifest)
    assert validation.valid, validation.errors

    return GraphCompileService().compile(manifest, node_executor_registry=registry).run(
        {
            "session_id": "session-1",
            "timeline_id": "timeline-1",
            "run_id": "run-1",
            "input": "hello",
        },
        RuntimeContext("session-1", "timeline-1", "trace-1"),
    )


class SequenceProvider:
    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)

    def complete(self, messages):
        del messages
        return self._responses.pop(0)


class IntentTool:
    async def run(self, args):
        return {"approved": args["intent"] == "yes"}


def manifest_payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "runtime": {
            "nodes": [
                {
                    "id": "compose_prompt",
                    "type": "prompt",
                    "config": {
                        "template": "Classify {{input}}",
                        "input_mapping": {"input": "$state.input"},
                        "output_key": "prompt_text",
                    },
                },
                {
                    "id": "classifier",
                    "type": "llm",
                    "config": {
                        "model": "default",
                        "prompt": "{{prompt}}",
                        "input_mapping": {"prompt": "$state.prompt_text"},
                        "output_key": "intent",
                    },
                },
                {
                    "id": "lookup",
                    "type": "tool",
                    "config": {
                        "tool_name": "intent.lookup",
                        "args": {"intent": "$state.intent"},
                        "output_key": "lookup_result",
                    },
                },
                {
                    "id": "check",
                    "type": "condition",
                    "config": {"source": "$state.lookup_result.approved", "operator": "is_true", "state_key": "route"},
                },
                {
                    "id": "answer_yes",
                    "type": "llm",
                    "config": {"model": "default", "prompt_template": "yes", "output_key": "answer"},
                },
                {
                    "id": "answer_no",
                    "type": "llm",
                    "config": {"model": "default", "prompt_template": "no", "output_key": "answer"},
                },
                {"id": "final", "type": "output", "config": {"source": "$state.answer"}},
            ],
            "edges": [
                {"id": "start-compose", "source": "START", "target": "compose_prompt"},
                {"id": "compose-classifier", "source": "compose_prompt", "target": "classifier"},
                {"id": "classifier-lookup", "source": "classifier", "target": "lookup"},
                {"id": "lookup-check", "source": "lookup", "target": "check"},
                {"id": "check-yes", "source": "check", "target": "answer_yes", "route": "true"},
                {"id": "check-no", "source": "check", "target": "answer_no", "route": "false"},
                {"id": "yes-final", "source": "answer_yes", "target": "final"},
                {"id": "no-final", "source": "answer_no", "target": "final"},
                {"id": "final-end", "source": "final", "target": "END"},
            ],
        },
        "ui": {"nodes": {}, "viewport": {}},
    }


if __name__ == "__main__":
    unittest.main()
