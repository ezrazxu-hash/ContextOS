import unittest


class WorkflowV2ConditionRuntimeTests(unittest.TestCase):
    def test_condition_routes_by_enum_field_without_extra_llm_call(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(condition_workflow("equals", "technical"))
        definitions.publish("condition-flow", validator=WorkflowV2DefinitionValidator())
        llm = SequentialJsonLlmClient([
            '{"category":"technical","confidence":0.91,"summary":"API issue"}',
            '{"summary":"Route technical"}',
        ])

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
            workflow_id="condition-flow",
            version=1,
            input_payload={"message": "API request"},
        )

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(len(llm.calls), 2)
        self.assertEqual([result["nodeId"] for result in run["nodeResults"]], ["classify", "route", "technical-agent"])
        self.assertEqual(run["nodeResults"][1]["data"], {"branch": "technical", "target": "technical-agent"})
        self.assertEqual(run["output"], {"summary": "Route technical"})

    def test_condition_supports_number_greater_than_or_equal_and_first_matching_branch(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = condition_workflow("greaterThanOrEqual", 0.8, field="confidence")
        definition["nodes"][1]["config"]["branches"] = [
            {"handle": "low", "source": {"nodeId": "classify", "path": ["confidence"]}, "operator": "greaterThanOrEqual", "value": 0.5},
            {"handle": "high", "source": {"nodeId": "classify", "path": ["confidence"]}, "operator": "greaterThanOrEqual", "value": 0.8},
        ]
        definitions.create(definition)
        definitions.publish("condition-flow", validator=WorkflowV2DefinitionValidator())
        llm = SequentialJsonLlmClient([
            '{"category":"technical","confidence":0.91,"summary":"API issue"}',
            '{"summary":"First branch wins"}',
        ])

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
            workflow_id="condition-flow",
            version=1,
            input_payload={"message": "API request"},
        )

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["nodeResults"][1]["data"]["branch"], "low")

    def test_condition_supports_string_contains_and_default_branch(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(condition_workflow("contains", "billing", field="summary", default_target="business-agent"))
        definitions.publish("condition-flow", validator=WorkflowV2DefinitionValidator())
        llm = SequentialJsonLlmClient([
            '{"category":"other","confidence":0.4,"summary":"general request"}',
            '{"summary":"Default branch"}',
        ])

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
            workflow_id="condition-flow",
            version=1,
            input_payload={"message": "hello"},
        )

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["nodeResults"][1]["data"], {"branch": "default", "target": "business-agent"})
        self.assertEqual(run["nodeResults"][2]["nodeId"], "business-agent")

    def test_condition_missing_field_fails_without_calling_next_agent(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = condition_workflow("equals", "technical")
        definition["nodes"][0]["config"]["outputSchema"]["required"] = ["confidence", "summary"]
        definitions.create(definition)
        definitions.publish("condition-flow", validator=WorkflowV2DefinitionValidator())
        llm = SequentialJsonLlmClient(['{"confidence":0.91,"summary":"API issue"}'])

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
            workflow_id="condition-flow",
            version=1,
            input_payload={"message": "API request"},
        )

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "CONDITION_FIELD_NOT_FOUND")
        self.assertEqual(run["error"]["field"], "classify.category")
        self.assertEqual(len(llm.calls), 1)


class SequentialJsonLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[list[dict[str, object]]] = []

    def complete(self, messages: list[dict[str, object]], options=None) -> str:
        del options
        self.calls.append(messages)
        if not self.responses:
            raise AssertionError("No LLM response fixture left")
        return self.responses.pop(0)


def condition_workflow(operator: str, value: object, *, field: str = "category", default_target: str = "fallback-agent") -> dict[str, object]:
    return {
        "id": "condition-flow",
        "name": "Condition Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "classify",
                "type": "agent",
                "config": {
                    "instruction": "Classify request",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {
                        "type": "object",
                        "required": ["category", "confidence", "summary"],
                        "properties": {
                            "category": {"type": "string", "enum": ["technical", "business", "other"]},
                            "confidence": {"type": "number"},
                            "summary": {"type": "string"},
                        },
                    },
                },
            },
            {
                "id": "route",
                "type": "condition",
                "config": {
                    "branches": [
                        {"handle": "technical", "source": {"nodeId": "classify", "path": [field]}, "operator": operator, "value": value}
                    ],
                    "defaultTarget": default_target,
                },
            },
            {
                "id": "technical-agent",
                "type": "agent",
                "config": {
                    "instruction": "Handle technical request",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {
                "id": "business-agent",
                "type": "agent",
                "config": {
                    "instruction": "Handle business request",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {
                "id": "fallback-agent",
                "type": "agent",
                "config": {
                    "instruction": "Handle fallback request",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [
            {"source": "START", "target": "classify"},
            {"source": "classify", "target": "route"},
            {"source": "route", "target": "technical-agent", "sourceHandle": "technical"},
            {"source": "route", "target": default_target, "sourceHandle": "default"},
            {"source": "technical-agent", "target": "end-1"},
            {"source": "business-agent", "target": "end-1"},
            {"source": "fallback-agent", "target": "end-1"},
        ],
    }


if __name__ == "__main__":
    unittest.main()
