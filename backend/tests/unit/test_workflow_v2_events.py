import unittest


class WorkflowV2RuntimeEventTests(unittest.TestCase):
    def test_single_agent_run_records_ordered_workflow_node_and_schema_events(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(valid_workflow("Return a summary"))
        definitions.publish("event-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient(['{"summary":"Evented"}']),
        ).start(workflow_id="event-flow", version=1, input_payload={"message": "hello"})

        events = run["events"]
        self.assertEqual(
            [event["eventType"] for event in events],
            [
                "WorkflowStarted",
                "NodeStarted",
                "LlmCallStarted",
                "LlmCallCompleted",
                "SchemaValidationSucceeded",
                "NodeCompleted",
                "WorkflowCompleted",
            ],
        )
        self.assertEqual([event["sequence"] for event in events], list(range(1, len(events) + 1)))
        self.assertTrue(all(event["runId"] == run["id"] for event in events))
        self.assertEqual(events[1]["nodeId"], "agent-1")
        self.assertEqual(events[-1]["payload"]["status"], "succeeded")

    def test_tool_loop_records_llm_and_tool_events_in_execution_order(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Use echo before answering")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "auto", "allowedTools": ["context.echo"]}
        tool_registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        definitions.create(definition)
        definitions.publish("event-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":"mars"}}]}',
                '{"summary":"Echoed mars"}',
            ]),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)]),
        ).start(workflow_id="event-flow", version=1, input_payload={"message": "research mars"})

        self.assertEqual(
            [event["eventType"] for event in run["events"]],
            [
                "WorkflowStarted",
                "NodeStarted",
                "LlmCallStarted",
                "LlmCallCompleted",
                "ToolCallStarted",
                "ToolCallCompleted",
                "LlmCallStarted",
                "LlmCallCompleted",
                "SchemaValidationSucceeded",
                "NodeCompleted",
                "WorkflowCompleted",
            ],
        )
        tool_events = [event for event in run["events"] if event["eventType"].startswith("ToolCall")]
        self.assertEqual([event["payload"]["toolCallId"] for event in tool_events], ["call-1", "call-1"])


class SequentialJsonLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    def complete(self, messages: list[dict[str, object]], options=None) -> str:
        del messages, options
        if not self.responses:
            raise AssertionError("No LLM response fixture left")
        return self.responses.pop(0)


async def echo_tool(args: dict[str, object]) -> object:
    return {"echo": args.get("query")}


def valid_workflow(instruction: str) -> dict[str, object]:
    return {
        "id": "event-flow",
        "name": "Event Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "agent-1",
                "type": "agent",
                "config": {
                    "instruction": instruction,
                    "visibility": "visible",
                    "toolPolicy": {"mode": "disabled"},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "agent-1"}, {"source": "agent-1", "target": "end-1"}],
    }


if __name__ == "__main__":
    unittest.main()
