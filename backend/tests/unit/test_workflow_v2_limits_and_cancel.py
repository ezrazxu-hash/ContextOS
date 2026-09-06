import threading
import time
import unittest


class WorkflowV2LimitsAndCancelTests(unittest.TestCase):
    def test_max_llm_turns_per_node_stops_tool_loop_before_next_llm_call(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = tool_workflow()
        definition["runtimeLimits"] = {"maxLlmTurnsPerNode": 1}
        tool_registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        definitions.create(definition)
        definitions.publish("limit-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))
        llm = SequentialJsonLlmClient([
            '{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":"mars"}}]}',
            '{"summary":"Should not be called"}',
        ])

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=llm,
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)]),
        ).start(workflow_id="limit-flow", version=1, input_payload={"message": "research"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "WORKFLOW_LIMIT_EXCEEDED")
        self.assertEqual(run["error"]["limit"], "maxLlmTurnsPerNode")
        self.assertEqual(len(llm.calls), 1)

    def test_max_tool_calls_per_node_counts_each_tool_call(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = tool_workflow()
        definition["runtimeLimits"] = {"maxToolCallsPerNode": 1}
        tool_registry = ToolRegistry([ToolMetadata(tool_id="context.echo", name="Context Echo", side_effect=SideEffect.READ)])
        definitions.create(definition)
        definitions.publish("limit-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"toolCalls":[{"id":"call-1","name":"context.echo","arguments":{"query":"a"}},{"id":"call-2","name":"context.echo","arguments":{"query":"b"}}]}',
            ]),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("context.echo", echo_tool)]),
        ).start(workflow_id="limit-flow", version=1, input_payload={"message": "research"})

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "WORKFLOW_LIMIT_EXCEEDED")
        self.assertEqual(run["error"]["limit"], "maxToolCallsPerNode")
        self.assertEqual([message.get("toolCallId") for message in run["messages"] if message["role"] == "tool"], ["call-1"])

    def test_max_node_executions_stops_graph_before_dispatching_next_node(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = two_agent_workflow()
        definition["runtimeLimits"] = {"maxNodeExecutions": 1}
        definitions.create(definition)
        definitions.publish("two-agent-flow", validator=WorkflowV2DefinitionValidator())
        llm = SequentialJsonLlmClient(['{"summary":"First"}', '{"summary":"Second"}'])

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
            workflow_id="two-agent-flow",
            version=1,
            input_payload={"message": "hello"},
        )

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "WORKFLOW_LIMIT_EXCEEDED")
        self.assertEqual(run["error"]["limit"], "maxNodeExecutions")
        self.assertEqual(len(llm.calls), 1)

    def test_workflow_timeout_fails_with_readable_limit_error(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Return slowly")
        definition["runtimeLimits"] = {"workflowTimeoutMs": 1}
        definitions.create(definition)
        definitions.publish("limit-flow", validator=WorkflowV2DefinitionValidator())

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=SlowJsonLlmClient('{"summary":"late"}')).start(
            workflow_id="limit-flow",
            version=1,
            input_payload={"message": "hello"},
        )

        self.assertEqual(run["status"], "failed")
        self.assertEqual(run["error"]["code"], "WORKFLOW_LIMIT_EXCEEDED")
        self.assertEqual(run["error"]["limit"], "workflowTimeoutMs")

    def test_max_schema_retries_allows_transient_correction_before_failure(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = valid_workflow("Return a valid summary")
        definition["runtimeLimits"] = {"maxSchemaRetries": 1}
        definitions.create(definition)
        definitions.publish("limit-flow", validator=WorkflowV2DefinitionValidator())
        llm = SequentialJsonLlmClient(['{"summary":42}', '{"summary":"Recovered"}'])

        run = WorkflowV2RunService(definitions, InMemoryWorkflowV2RunStore(), llm_client=llm).start(
            workflow_id="limit-flow",
            version=1,
            input_payload={"message": "hello"},
        )

        schema_steps = [step["status"] for step in run["executionDetails"]["nodes"][0]["steps"] if step["type"] == "schema_validation"]
        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["output"], {"summary": "Recovered"})
        self.assertEqual(schema_steps, ["failed", "succeeded"])
        self.assertEqual(len(llm.calls), 2)

    def test_cancel_async_run_stops_before_dispatching_next_node(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(two_agent_workflow())
        definitions.publish("two-agent-flow", validator=WorkflowV2DefinitionValidator())
        store = InMemoryWorkflowV2RunStore()
        llm = BlockingThenSequentialLlmClient(['{"summary":"First"}', '{"summary":"Second"}'])
        service = WorkflowV2RunService(definitions, store, llm_client=llm)

        started = service.start_async(workflow_id="two-agent-flow", version=1, input_payload={"message": "hello"})
        self.assertEqual(started["status"], "running")
        self.assertTrue(llm.entered_first_call.wait(timeout=1))
        cancelled = service.cancel(started["id"])
        llm.release_first_call.set()
        final = wait_for_terminal_run(service, started["id"])

        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(final["status"], "cancelled")
        self.assertEqual(final["error"]["code"], "WORKFLOW_CANCELLED")
        self.assertEqual(len(llm.calls), 1)

    def test_cancel_async_parent_run_cancels_running_child_workflow(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(child_two_agent_workflow())
        definitions.publish("child-two-agent-flow", validator=WorkflowV2DefinitionValidator())
        definitions.create(parent_child_workflow())
        definitions.publish("parent-child-flow", validator=WorkflowV2DefinitionValidator())
        store = InMemoryWorkflowV2RunStore()
        llm = BlockingThenSequentialLlmClient(['{"summary":"Child first"}', '{"summary":"Child second"}'])
        service = WorkflowV2RunService(definitions, store, llm_client=llm)

        started = service.start_async(workflow_id="parent-child-flow", version=1, input_payload={"message": "hello"})
        self.assertTrue(llm.entered_first_call.wait(timeout=1))
        service.cancel(started["id"])
        llm.release_first_call.set()
        time.sleep(0.05)
        final = service.get(started["id"])

        self.assertEqual(final["status"], "cancelled")
        self.assertEqual(final["error"]["code"], "WORKFLOW_CANCELLED")
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


class SlowJsonLlmClient:
    def __init__(self, response: str) -> None:
        self.response = response

    def complete(self, messages: list[dict[str, object]], options=None) -> str:
        del messages, options
        time.sleep(0.02)
        return self.response


class BlockingThenSequentialLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.calls: list[list[dict[str, object]]] = []
        self.entered_first_call = threading.Event()
        self.release_first_call = threading.Event()

    def complete(self, messages: list[dict[str, object]], options=None) -> str:
        del options
        self.calls.append(messages)
        if len(self.calls) == 1:
            self.entered_first_call.set()
            self.release_first_call.wait(timeout=2)
        if not self.responses:
            raise AssertionError("No LLM response fixture left")
        return self.responses.pop(0)


async def echo_tool(args: dict[str, object]) -> object:
    return {"echo": args.get("query")}


def wait_for_terminal_run(service, run_id: str) -> dict[str, object]:
    for _ in range(100):
        run = service.get(run_id)
        if run["status"] in {"succeeded", "failed", "cancelled"}:
            return run
        time.sleep(0.01)
    raise AssertionError("Run did not reach a terminal state")


def valid_workflow(instruction: str) -> dict[str, object]:
    return {
        "id": "limit-flow",
        "name": "Limit Flow",
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


def tool_workflow() -> dict[str, object]:
    definition = valid_workflow("Use the echo tool")
    definition["tools"] = ["context.echo"]
    definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "auto", "allowedTools": ["context.echo"]}
    return definition


def two_agent_workflow() -> dict[str, object]:
    first = valid_workflow("First")
    first["id"] = "two-agent-flow"
    first["name"] = "Two Agent Flow"
    first["nodes"] = [
        first["nodes"][0],
        {
            "id": "agent-2",
            "type": "agent",
            "config": {
                "instruction": "Second",
                "visibility": "visible",
                "toolPolicy": {"mode": "disabled"},
                "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
            },
        },
        {"id": "end-1", "type": "end"},
    ]
    first["edges"] = [
        {"source": "START", "target": "agent-1"},
        {"source": "agent-1", "target": "agent-2"},
        {"source": "agent-2", "target": "end-1"},
    ]
    return first


def child_two_agent_workflow() -> dict[str, object]:
    definition = two_agent_workflow()
    definition["id"] = "child-two-agent-flow"
    definition["name"] = "Child Two Agent Flow"
    return definition


def parent_child_workflow() -> dict[str, object]:
    return {
        "id": "parent-child-flow",
        "name": "Parent Child Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "child",
                "type": "workflow",
                "config": {
                    "workflowId": "child-two-agent-flow",
                    "version": 1,
                    "messageContextMode": "isolated",
                    "inputBindings": {"message": {"kind": "workflowInput", "path": ["message"]}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "child"}, {"source": "child", "target": "end-1"}],
    }


if __name__ == "__main__":
    unittest.main()
