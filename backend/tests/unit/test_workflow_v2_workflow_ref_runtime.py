import unittest


class WorkflowV2WorkflowRefRuntimeTests(unittest.TestCase):
    def test_workflow_ref_maps_node_output_and_constant_into_published_child_workflow(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(child_research_workflow())
        definitions.publish("research-flow", validator=WorkflowV2DefinitionValidator())
        definitions.create(parent_workflow_ref_workflow())
        definitions.publish("parent-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"topic":"mars"}',
                '{"summary":"Research complete"}',
            ]),
        ).start(workflow_id="parent-flow", version=1, input_payload={"message": "Research Mars"})

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual([result["nodeId"] for result in run["nodeResults"]], ["analyze", "research"])
        self.assertEqual(run["nodeResults"][1]["data"], {"summary": "Research complete"})
        self.assertEqual(run["nodeResults"][1]["metadata"]["workflowId"], "research-flow")
        self.assertEqual(run["nodeResults"][1]["metadata"]["workflowVersion"], 1)
        self.assertEqual(run["output"], {"summary": "Research complete"})

    def test_workflow_ref_fails_when_child_input_schema_rejects_resolved_bindings(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        parent = parent_workflow_ref_workflow()
        del parent["nodes"][1]["config"]["inputBindings"]["priority"]
        definitions = WorkflowV2DefinitionService()
        definitions.create(child_research_workflow())
        definitions.publish("research-flow", validator=WorkflowV2DefinitionValidator())
        definitions.create(parent)
        definitions.publish("parent-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient(['{"topic":"mars"}']),
        ).start(workflow_id="parent-flow", version=1, input_payload={"message": "Research Mars"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "workflow_ref.input_schema_invalid")
        self.assertEqual(run["nodeResults"][1]["nodeId"], "research")

    def test_workflow_ref_fails_when_child_output_schema_rejects_child_result(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        child = child_research_workflow()
        child["nodes"][0]["config"]["outputSchema"] = {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "number"}}}
        definitions = WorkflowV2DefinitionService()
        definitions.create(child)
        definitions.publish("research-flow", validator=WorkflowV2DefinitionValidator())
        definitions.create(parent_workflow_ref_workflow())
        definitions.publish("parent-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"topic":"mars"}',
                '{"summary":42}',
            ]),
        ).start(workflow_id="parent-flow", version=1, input_payload={"message": "Research Mars"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "workflow_ref.output_schema_invalid")
        self.assertEqual(run["error"]["field"], "$.summary")

    def test_workflow_ref_inherit_messages_updates_parent_history_but_isolated_keeps_child_messages_private(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        inherited_run, inherited_llm = run_parent_with_message_mode("inherit")
        isolated_run, isolated_llm = run_parent_with_message_mode("isolated")

        self.assertEqual(inherited_run["finalResult"]["message"], '{"summary":"Child answer"}')
        self.assertEqual(isolated_run["finalResult"]["message"], '{"topic":"mars"}')
        self.assertEqual([message["role"] for message in inherited_run["messages"]], ["user", "assistant", "user", "assistant"])
        self.assertEqual([message["role"] for message in isolated_run["messages"]], ["user", "assistant"])
        self.assertIn('{"priority": "high", "topic": "mars"}', [message["content"] for message in inherited_llm.calls[1] if message["role"] == "user"])
        self.assertEqual([message["role"] for message in isolated_llm.calls[1]], ["system", "system", "system", "user"])

    def test_workflow_ref_stops_recursive_child_workflows_at_depth_limit(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(self_ref_workflow())
        definitions.publish("self-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([]),
        ).start(workflow_id="self-flow", version=1, input_payload={"message": "loop"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "workflow_ref.depth_limit_exceeded")
        self.assertEqual(run["nodeResults"][-1]["status"], "failed")

    def test_workflow_ref_wraps_child_workflow_failure(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(child_research_workflow())
        definitions.publish("research-flow", validator=WorkflowV2DefinitionValidator())
        definitions.create(parent_workflow_ref_workflow())
        definitions.publish("parent-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"topic":"mars"}',
                '{"summary":42}',
            ]),
        ).start(workflow_id="parent-flow", version=1, input_payload={"message": "Research Mars"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "workflow_ref.child_failed")
        self.assertEqual(run["nodeResults"][1]["status"], "failed")


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


def child_research_workflow() -> dict[str, object]:
    return {
        "id": "research-flow",
        "name": "Research Flow",
        "schemaVersion": 2,
        "inputSchema": {
            "type": "object",
            "required": ["topic", "priority"],
            "properties": {"topic": {"type": "string"}, "priority": {"type": "string"}},
        },
        "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
        "tools": [],
        "nodes": [
            {
                "id": "research-agent",
                "type": "agent",
                "config": {
                    "instruction": "Research the topic.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "research-agent"}, {"source": "research-agent", "target": "end-1"}],
    }


def parent_workflow_ref_workflow() -> dict[str, object]:
    return {
        "id": "parent-flow",
        "name": "Parent Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "analyze",
                "type": "agent",
                "config": {
                    "instruction": "Extract the research topic.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["topic"], "properties": {"topic": {"type": "string"}}},
                },
            },
            {
                "id": "research",
                "type": "workflow",
                "config": {
                    "workflowId": "research-flow",
                    "version": 1,
                    "messageContextMode": "inherit",
                    "inputBindings": {
                        "topic": {"kind": "nodeOutput", "nodeId": "analyze", "path": ["topic"]},
                        "priority": {"kind": "constant", "value": "high"},
                    },
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [
            {"source": "START", "target": "analyze"},
            {"source": "analyze", "target": "research"},
            {"source": "research", "target": "end-1"},
        ],
    }


def run_parent_with_message_mode(mode: str) -> tuple[dict[str, object], SequentialJsonLlmClient]:
    from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
    from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
    from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

    parent = parent_workflow_ref_workflow()
    parent["nodes"][1]["config"]["messageContextMode"] = mode
    definitions = WorkflowV2DefinitionService()
    definitions.create(child_research_workflow())
    definitions.publish("research-flow", validator=WorkflowV2DefinitionValidator())
    definitions.create(parent)
    definitions.publish("parent-flow", validator=WorkflowV2DefinitionValidator())
    llm = SequentialJsonLlmClient(['{"topic":"mars"}', '{"summary":"Child answer"}'])
    run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
        workflow_id="parent-flow",
        version=1,
        input_payload={"message": "Research Mars"},
    )
    return run, llm


def self_ref_workflow() -> dict[str, object]:
    return {
        "id": "self-flow",
        "name": "Self Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "self",
                "type": "workflow",
                "config": {
                    "workflowId": "self-flow",
                    "version": 1,
                    "messageContextMode": "isolated",
                    "inputBindings": {"message": {"kind": "workflowInput", "path": ["message"]}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "self"}, {"source": "self", "target": "end-1"}],
    }


if __name__ == "__main__":
    unittest.main()
