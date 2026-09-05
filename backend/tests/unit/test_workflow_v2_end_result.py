import unittest


class WorkflowV2EndResultTests(unittest.TestCase):
    def test_end_default_final_result_uses_last_visible_assistant_message_not_hidden_tail(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(two_agent_end_workflow())
        definitions.publish("end-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"summary":"Visible answer"}',
                '{"summary":"Hidden internal note"}',
            ]),
        ).start(workflow_id="end-flow", version=1, input_payload={"message": "hello"})

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["messages"][-1]["visible"], False)
        self.assertEqual(run["finalResult"], {"message": '{"summary":"Visible answer"}', "data": None, "artifacts": []})

    def test_end_final_result_binds_structured_data_from_node_result(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definition = two_agent_end_workflow()
        definition["nodes"][-1]["config"] = {
            "finalResult": {
                "data": {"kind": "nodeOutput", "nodeId": "visible-agent", "path": ["summary"]},
                "message": {"mode": "lastVisibleAssistant"},
                "artifacts": {"mode": "allVisible"},
            }
        }
        definitions = WorkflowV2DefinitionService()
        definitions.create(definition)
        definitions.publish("end-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"summary":"Visible answer"}',
                '{"summary":"Hidden internal note"}',
            ]),
        ).start(workflow_id="end-flow", version=1, input_payload={"message": "hello"})

        self.assertEqual(run["finalResult"], {"message": '{"summary":"Visible answer"}', "data": "Visible answer", "artifacts": []})


class SequentialJsonLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    def complete(self, messages: list[dict[str, object]], options=None) -> str:
        del messages, options
        if not self.responses:
            raise AssertionError("No LLM response fixture left")
        return self.responses.pop(0)


def two_agent_end_workflow() -> dict[str, object]:
    return {
        "id": "end-flow",
        "name": "End Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "visible-agent",
                "type": "agent",
                "config": {
                    "instruction": "Visible reply",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {
                "id": "hidden-agent",
                "type": "agent",
                "config": {
                    "instruction": "Hidden reply",
                    "visibility": "hidden",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end", "config": {}},
        ],
        "edges": [
            {"source": "START", "target": "visible-agent"},
            {"source": "visible-agent", "target": "hidden-agent"},
            {"source": "hidden-agent", "target": "end-1"},
        ],
    }


if __name__ == "__main__":
    unittest.main()
