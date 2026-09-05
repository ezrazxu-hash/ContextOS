import unittest


class WorkflowV2RuntimeTests(unittest.TestCase):
    def test_single_agent_run_uses_published_version_and_returns_structured_result(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        created = definitions.create(valid_workflow("First instruction"))
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator())
        definitions.save_draft("support-flow", {**created, **valid_workflow("Second instruction")}, expected_revision=1)
        llm = RecordingJsonLlmClient('{"summary": "Need API work"}')

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
            workflow_id="support-flow",
            version=1,
            input_payload={"message": "Please classify this request"},
        )

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["workflowVersion"], 1)
        self.assertEqual(run["output"], {"summary": "Need API work"})
        self.assertEqual(run["nodeResults"][0]["nodeId"], "agent-1")
        self.assertEqual(run["nodeResults"][0]["data"], {"summary": "Need API work"})
        self.assertIn("First instruction", llm.calls[0][0]["content"])
        self.assertNotIn("Second instruction", str(llm.calls[0]))

    def test_single_agent_run_fails_when_llm_output_does_not_match_schema(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(valid_workflow("Return a summary"))
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=RecordingJsonLlmClient('{"summary": 42}')).start(
            workflow_id="support-flow",
            version=1,
            input_payload={"message": "Please classify this request"},
        )

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["nodeResults"][0]["status"], "failed")
        self.assertEqual(run["error"]["code"], "workflow.output_schema_invalid")
        self.assertEqual(run["error"]["field"], "$.summary")

    def test_agent_tool_loop_executes_one_tool_call_and_pairs_messages(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Use search before summarizing")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "auto", "allowedTools": ["context.echo"]}
        definitions.create(definition)
        tool_registry = ToolRegistry([
            ToolMetadata(
                tool_id="context.echo",
                name="Context Echo",
                side_effect=SideEffect.READ,
                input_schema={"type": "object", "required": ["query"], "properties": {"query": {"type": "string"}}},
            )
        ])
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))
        tool_executor_registry = ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)])
        llm = SequentialJsonLlmClient([
            '{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":"mars"}}]}',
            '{"summary":"Found mars"}',
        ])

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=llm,
            tool_registry=tool_registry,
            tool_executor_registry=tool_executor_registry,
        ).start(
            workflow_id="support-flow",
            version=1,
            input_payload={"message": "research mars"},
        )

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["output"], {"summary": "Found mars"})
        self.assertEqual(len(llm.calls), 2)
        self.assertEqual(
            [(message["role"], message.get("toolCallId")) for message in run["messages"]],
            [("user", None), ("assistant", None), ("tool", "call-1"), ("assistant", None)],
        )
        self.assertEqual(run["messages"][1]["toolCalls"][0]["id"], "call-1")
        self.assertEqual(run["messages"][2]["toolCallId"], "call-1")
        self.assertEqual(
            [step["type"] for step in run["executionDetails"]["nodes"][0]["steps"]],
            ["llm_call", "tool_call", "tool_result", "llm_call", "schema_validation", "node_result"],
        )
        self.assertIn("context.echo", str(llm.calls[0]))
        self.assertIn("tool", [message["role"] for message in llm.calls[1]])

    def test_agent_tool_loop_executes_multiple_tool_calls_serially(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Use available tools")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "auto", "allowedTools": ["context.echo"]}
        definitions.create(definition)
        tool_registry = ToolRegistry([
            ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ, input_schema={"type": "object", "properties": {"query": {"type": "string"}}})
        ])
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))
        llm = SequentialJsonLlmClient([
            '{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":"alpha"}},{"id":"call-2","name":"context.echo","arguments":{"query":"beta"}}]}',
            '{"summary":"Two lookups complete"}',
        ])

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=llm,
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)]),
        ).start(workflow_id="support-flow", version=1, input_payload={"message": "compare alpha beta"})

        tool_results = [message for message in run["messages"] if message["role"] == "tool"]
        self.assertEqual(run["status"], "succeeded")
        self.assertEqual([message["toolCallId"] for message in tool_results], ["call-1", "call-2"])
        self.assertEqual([message["data"]["echo"] for message in tool_results], ["alpha", "beta"])

    def test_agent_tool_loop_rejects_tool_not_allowed(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("No tools")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "disabled"}
        definitions.create(definition)
        tool_registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient(['{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{}}]}']),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)]),
        ).start(workflow_id="support-flow", version=1, input_payload={"message": "hello"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "TOOL_NOT_ALLOWED")

    def test_agent_tool_loop_rejects_invalid_tool_arguments(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Use echo")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "auto", "allowedTools": ["context.echo"]}
        definitions.create(definition)
        tool_registry = ToolRegistry([
            ToolMetadata(
                tool_id="context.echo",
                name="Context Echo",
                side_effect=SideEffect.READ,
                input_schema={"type": "object", "required": ["query"], "properties": {"query": {"type": "string"}}},
            )
        ])
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient(['{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":42}}]}']),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)]),
        ).start(workflow_id="support-flow", version=1, input_payload={"message": "hello"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "TOOL_ARGUMENT_INVALID")
        self.assertEqual(run["error"]["field"], "$.query")

    def test_agent_tool_loop_fails_when_required_tool_was_not_called(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Must use echo")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "required", "allowedTools": ["context.echo"], "requiredTools": ["context.echo"]}
        definitions.create(definition)
        tool_registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=RecordingJsonLlmClient('{"summary":"Skipped required tool"}'),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)]),
        ).start(workflow_id="support-flow", version=1, input_payload={"message": "hello"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "REQUIRED_TOOL_NOT_CALLED")

    def test_agent_tool_loop_records_failed_tool_result_when_executor_fails(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Use echo")
        definition["tools"] = ["context.echo"]
        definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "auto", "allowedTools": ["context.echo"]}
        definitions.create(definition)
        tool_registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        definitions.publish("support-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient(['{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":"mars"}}]}']),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", failing_tool)]),
        ).start(workflow_id="support-flow", version=1, input_payload={"message": "hello"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "TOOL_EXECUTION_FAILED")
        self.assertEqual(run["messages"][2]["role"], "tool")
        self.assertEqual(run["messages"][2]["toolCallId"], "call-1")
        self.assertEqual(run["messages"][2]["status"], "failed")


class RecordingJsonLlmClient:
    def __init__(self, response: str) -> None:
        self.response = response
        self.calls: list[list[dict[str, str]]] = []

    def complete(self, messages: list[dict[str, str]], options=None) -> str:
        del options
        self.calls.append(messages)
        return self.response


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


async def echo_tool(args: dict[str, object]) -> object:
    return {"echo": args.get("query")}


async def failing_tool(args: dict[str, object]) -> object:
    del args
    raise RuntimeError("tool backend unavailable")


def valid_workflow(instruction: str) -> dict[str, object]:
    return {
        "id": "support-flow",
        "name": "Support Flow",
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
