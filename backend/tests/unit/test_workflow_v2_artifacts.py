import unittest


class WorkflowV2ArtifactRuntimeTests(unittest.TestCase):
    def test_tool_created_artifact_is_stored_once_and_referenced_from_run_surfaces(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definition = artifact_tool_workflow()
        definitions.create(definition)
        tool_registry = ToolRegistry([
            ToolMetadata(tool_id="report.file", name="Report File", side_effect=SideEffect.READ, input_schema={"type": "object"})
        ])
        definitions.publish("artifact-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))
        artifact_store = InMemoryWorkflowV2ArtifactStore()

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"toolCalls":[{"id":"call-1","name":"report.file","arguments":{}}]}',
                '{"summary":"Report ready"}',
            ]),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("report.file", report_file_tool)]),
            artifact_store=artifact_store,
        ).start(workflow_id="artifact-flow", version=1, input_payload={"message": "make report"})

        artifact_ref = run["artifacts"][0]
        self.assertEqual(artifact_ref["name"], "report.txt")
        self.assertEqual(artifact_ref["mimeType"], "text/plain")
        self.assertEqual(artifact_ref["createdByNodeId"], "agent-1")
        self.assertEqual(artifact_ref["visible"], True)
        self.assertNotIn("content", artifact_ref)
        self.assertNotIn("storageKey", artifact_ref)
        self.assertEqual(run["messages"][2]["artifacts"], [artifact_ref])
        self.assertEqual(run["nodeResults"][0]["artifacts"], [artifact_ref])
        self.assertEqual(run["finalResult"]["artifacts"], [artifact_ref])
        self.assertEqual(artifact_store.get_content(artifact_ref["id"])["content"], b"hello report")

    def test_agent_output_artifact_is_sanitized_to_refs_on_assistant_message_and_node_result(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(agent_artifact_workflow())
        definitions.publish("agent-artifact-flow", validator=WorkflowV2DefinitionValidator())
        artifact_store = InMemoryWorkflowV2ArtifactStore()

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"summary":"Image ready","artifacts":[{"name":"chart.png","mimeType":"image/png","content":"png-bytes"}]}',
            ]),
            artifact_store=artifact_store,
        ).start(workflow_id="agent-artifact-flow", version=1, input_payload={"message": "make chart"})

        artifact_ref = run["artifacts"][0]
        self.assertEqual(run["output"], {"summary": "Image ready"})
        self.assertEqual(run["messages"][1]["artifacts"], [artifact_ref])
        self.assertNotIn("png-bytes", str(run["messages"]))
        self.assertEqual(run["nodeResults"][0]["data"], {"summary": "Image ready"})
        self.assertEqual(run["nodeResults"][0]["artifacts"], [artifact_ref])
        self.assertEqual(artifact_store.get_content(artifact_ref["id"])["content"], b"png-bytes")

    def test_intermediate_visible_artifact_reaches_final_result_and_invisible_artifact_does_not(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        definitions = WorkflowV2DefinitionService()
        definitions.create(two_agent_artifact_workflow())
        tool_registry = ToolRegistry([
            ToolMetadata(tool_id="report.file", name="Report File", side_effect=SideEffect.READ, input_schema={"type": "object"})
        ])
        definitions.publish("two-agent-artifact-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=SequentialJsonLlmClient([
                '{"toolCalls":[{"id":"call-1","name":"report.file","arguments":{}}]}',
                '{"summary":"Intermediate report ready"}',
                '{"summary":"Final answer from later node"}',
            ]),
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("report.file", visible_and_invisible_report_tool)]),
            artifact_store=InMemoryWorkflowV2ArtifactStore(),
        ).start(workflow_id="two-agent-artifact-flow", version=1, input_payload={"message": "make report"})

        self.assertEqual(run["finalResult"]["message"], '{"summary":"Final answer from later node"}')
        self.assertEqual([artifact["name"] for artifact in run["artifacts"]], ["visible-report.txt", "internal-notes.txt"])
        self.assertEqual([artifact["name"] for artifact in run["nodeResults"][0]["artifacts"]], ["visible-report.txt", "internal-notes.txt"])
        self.assertEqual([artifact["name"] for artifact in run["finalResult"]["artifacts"]], ["visible-report.txt"])


class SequentialJsonLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    def complete(self, messages: list[dict[str, object]], options=None) -> str:
        del messages, options
        if not self.responses:
            raise AssertionError("No LLM response fixture left")
        return self.responses.pop(0)


async def report_file_tool(args: dict[str, object]) -> object:
    del args
    return {
        "data": {"ok": True},
        "artifacts": [
            {
                "name": "report.txt",
                "mimeType": "text/plain",
                "content": "hello report",
            }
        ],
    }


async def visible_and_invisible_report_tool(args: dict[str, object]) -> object:
    del args
    return {
        "data": {"ok": True},
        "artifacts": [
            {"name": "visible-report.txt", "mimeType": "text/plain", "content": "public"},
            {"name": "internal-notes.txt", "mimeType": "text/plain", "content": "private", "visible": False},
        ],
    }


def artifact_tool_workflow() -> dict[str, object]:
    return {
        "id": "artifact-flow",
        "name": "Artifact Flow",
        "schemaVersion": 2,
        "tools": ["report.file"],
        "nodes": [
            {
                "id": "agent-1",
                "type": "agent",
                "config": {
                    "instruction": "Create a report.",
                    "visibility": "visible",
                    "toolPolicy": {"mode": "auto", "allowedTools": ["report.file"]},
                    "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
                },
            },
            {"id": "end-1", "type": "end"},
        ],
        "edges": [{"source": "START", "target": "agent-1"}, {"source": "agent-1", "target": "end-1"}],
    }


def agent_artifact_workflow() -> dict[str, object]:
    definition = artifact_tool_workflow()
    definition["id"] = "agent-artifact-flow"
    definition["name"] = "Agent Artifact Flow"
    definition["tools"] = []
    definition["nodes"][0]["config"]["toolPolicy"] = {"mode": "disabled"}
    return definition


def two_agent_artifact_workflow() -> dict[str, object]:
    definition = artifact_tool_workflow()
    definition["id"] = "two-agent-artifact-flow"
    definition["name"] = "Two Agent Artifact Flow"
    definition["nodes"] = [
        definition["nodes"][0],
        {
            "id": "agent-2",
            "type": "agent",
            "config": {
                "instruction": "Return the final answer.",
                "visibility": "visible",
                "toolPolicy": {"mode": "disabled"},
                "outputSchema": {"type": "object", "required": ["summary"], "properties": {"summary": {"type": "string"}}},
            },
        },
        {"id": "end-1", "type": "end"},
    ]
    definition["edges"] = [
        {"source": "START", "target": "agent-1"},
        {"source": "agent-1", "target": "agent-2"},
        {"source": "agent-2", "target": "end-1"},
    ]
    return definition


if __name__ == "__main__":
    unittest.main()
