import unittest


class WorkflowSliceConditionTests(unittest.TestCase):
    def test_true_branch_only_executes_true_llm(self) -> None:
        state = run_slice(["yes", "true-answer"])

        self.assertEqual(state["visited_nodes"], ["classifier", "check", "answer_yes", "final"])
        self.assertEqual(state["output"], "true-answer")
        self.assertNotIn("answer_no", [event["data"]["node_id"] for event in state["runtime_events"]])

    def test_false_branch_only_executes_false_llm(self) -> None:
        state = run_slice(["no", "false-answer"])

        self.assertEqual(state["visited_nodes"], ["classifier", "check", "answer_no", "final"])
        self.assertEqual(state["output"], "false-answer")
        self.assertNotIn("answer_yes", [event["data"]["node_id"] for event in state["runtime_events"]])


def run_slice(responses: list[str]) -> dict[str, object]:
    from contextos.runtime.graph.nodes.condition import ConditionNodeExecutor
    from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
    from contextos.runtime.graph.nodes.output import OutputNodeExecutor
    from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
    from contextos.runtime.graph.runtime_context import RuntimeContext
    from contextos.template.compiler.compile_service import GraphCompileService
    from contextos.template.extension.registry import ExtensionRegistry
    from contextos.template.manifest.parser import parse_manifest
    from contextos.template.validator.validator import ManifestValidator
    from contextos.tool.registry.registry import ToolRegistry

    provider = SequenceProvider(responses)
    registry = NodeExecutorRegistry()
    registry.register(LLMNodeExecutor(provider))
    registry.register(ConditionNodeExecutor())
    registry.register(OutputNodeExecutor())
    manifest = parse_manifest(manifest_payload())

    validation = ManifestValidator(ExtensionRegistry(), ToolRegistry()).validate_result(manifest)
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


def manifest_payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "runtime": {
            "nodes": [
                {
                    "id": "classifier",
                    "type": "llm",
                    "config": {
                        "model": "default",
                        "prompt_template": "{{input}}",
                        "input_mapping": {"input": "$state.input"},
                        "output_key": "intent",
                    },
                },
                {
                    "id": "check",
                    "type": "condition",
                    "config": {"source": "$state.intent", "operator": "eq", "value": "yes", "state_key": "route"},
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
                {"id": "start-classifier", "source": "START", "target": "classifier"},
                {"id": "classifier-check", "source": "classifier", "target": "check"},
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
