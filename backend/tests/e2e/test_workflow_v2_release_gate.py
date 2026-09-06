import json
import unittest


class WorkflowV2ReleaseGateE2ETests(unittest.TestCase):
    def test_release_gate_sample_covers_agent_condition_tools_subworkflow_artifacts_end_and_events(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.registry.registry import ToolRegistry
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.demo_workflows import release_gate_workflow_definition, technical_research_workflow_definition
        from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        tool_registry = ToolRegistry([
            ToolMetadata(tool_id="web.search", name="Web Search", side_effect=SideEffect.READ, input_schema={"type": "object", "required": ["query"], "properties": {"query": {"type": "string"}}}),
            ToolMetadata(tool_id="file.generate", name="File Generator", side_effect=SideEffect.WRITE, input_schema={"type": "object", "required": ["title"], "properties": {"title": {"type": "string"}}}),
        ])
        definitions = WorkflowV2DefinitionService()
        definitions.create(technical_research_workflow_definition())
        definitions.publish("technical-research-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry))
        definitions.create(release_gate_workflow_definition(technical_workflow_id="technical-research-flow", technical_workflow_version=1))
        definitions.publish("release-gate-flow", validator=WorkflowV2DefinitionValidator(tool_registry=tool_registry, definition_service=definitions))
        artifact_store = InMemoryWorkflowV2ArtifactStore()
        llm = SequentialJsonLlmClient([
            '{"category":"technical","topic":"Mars APIs","confidence":0.91,"summary":"Technical request"}',
            '{"toolCalls":[{"id":"search-1","name":"web.search","arguments":{"query":"Mars APIs"}}]}',
            '{"researchSummary":"Mars API evidence collected"}',
            '{"toolCalls":[{"id":"file-1","name":"file.generate","arguments":{"title":"Mars API report"}}]}',
            '{"summary":"Technical report ready","category":"technical"}',
            '{"summary":"Final technical handoff","category":"technical"}',
        ])

        run = WorkflowV2RunService(
            definitions,
            InMemoryWorkflowV2RunStore(),
            llm_client=llm,
            tool_registry=tool_registry,
            tool_executor_registry=ToolExecutorRegistry([ToolExecutor("web.search", web_search_tool), ToolExecutor("file.generate", file_generate_tool)]),
            artifact_store=artifact_store,
        ).start(workflow_id="release-gate-flow", version=1, input_payload={"message": "Need research on Mars APIs"})

        tool_call_ids = [
            call["id"]
            for message in run["messages"]
            if message["role"] == "assistant"
            for call in message.get("toolCalls", [])
        ]
        tool_result_ids = [message["toolCallId"] for message in run["messages"] if message["role"] == "tool"]

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(run["output"], {"summary": "Final technical handoff", "category": "technical"})
        self.assertEqual(run["finalResult"]["data"], "Final technical handoff")
        self.assertEqual([result["nodeId"] for result in run["nodeResults"]], ["analyze-request", "route-category", "technical-research", "generate-final"])
        self.assertEqual(set(tool_call_ids), {"search-1", "file-1"})
        self.assertEqual(set(tool_result_ids), {"search-1", "file-1"})
        self.assertEqual(len(llm.calls), 6)
        self.assertIn("WorkflowStarted", [event["eventType"] for event in run["events"]])
        self.assertIn("ToolCallCompleted", [event["eventType"] for event in run["events"]])
        self.assertIn("WorkflowCompleted", [event["eventType"] for event in run["events"]])
        self.assertEqual(run["finalResult"]["artifacts"][0]["name"], "technical-report.md")
        self.assertEqual(artifact_store.get_content(run["finalResult"]["artifacts"][0]["id"])["content"], b"# Mars API report")
        self.assertNotIn("$state", json.dumps(run))
        self.assertNotIn("Use the technical research workflow", json.dumps(run["messages"]))


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


async def web_search_tool(args: dict[str, object]) -> object:
    return {"results": [{"title": "Mars API reference", "query": args.get("query")}]}


async def file_generate_tool(args: dict[str, object]) -> object:
    del args
    return {
        "data": {"path": "technical-report.md"},
        "artifacts": [{"name": "technical-report.md", "mimeType": "text/markdown", "content": "# Mars API report"}],
    }


if __name__ == "__main__":
    unittest.main()
