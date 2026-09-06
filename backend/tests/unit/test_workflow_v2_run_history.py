from pathlib import Path
import tempfile
import unittest


class WorkflowV2RunHistoryPersistenceTests(unittest.TestCase):
    def test_run_history_reloads_with_message_sequences_events_and_artifact_content(self) -> None:
        from contextos.runtime.persistence.json_store import JsonRuntimeStore
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator
        from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore
        from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService

        with tempfile.TemporaryDirectory() as temp_dir:
            store_path = Path(temp_dir) / "runtime-state.json"
            store = JsonRuntimeStore(store_path)
            definitions = WorkflowV2DefinitionService(store)
            definitions.create(valid_workflow())
            definitions.publish("history-flow", validator=WorkflowV2DefinitionValidator())
            run_store = InMemoryWorkflowV2RunStore(store)
            artifact_store = InMemoryWorkflowV2ArtifactStore(store)

            run = WorkflowV2RunService(
                definitions,
                run_store,
                llm_client=SequentialJsonLlmClient([
                    '{"summary":"Report ready","artifacts":[{"name":"report.txt","mimeType":"text/plain","content":"hello history"}]}',
                ]),
                artifact_store=artifact_store,
            ).start(workflow_id="history-flow", version=1, input_payload={"message": "make report"})

            reloaded_store = JsonRuntimeStore(store_path)
            reloaded_run = InMemoryWorkflowV2RunStore(reloaded_store).get(run["id"])
            reloaded_artifacts = InMemoryWorkflowV2ArtifactStore(reloaded_store)
            artifact_id = reloaded_run["artifacts"][0]["id"]

        self.assertEqual(reloaded_run["status"], "succeeded")
        self.assertEqual([message["sequence"] for message in reloaded_run["messages"]], [1, 2])
        self.assertEqual([event["sequence"] for event in reloaded_run["events"]], list(range(1, len(reloaded_run["events"]) + 1)))
        self.assertEqual(reloaded_run["nodeResults"][0]["data"], {"summary": "Report ready"})
        self.assertEqual(reloaded_artifacts.get_content(artifact_id)["content"], b"hello history")


class SequentialJsonLlmClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)

    def complete(self, messages: list[dict[str, object]], options=None) -> str:
        del messages, options
        if not self.responses:
            raise AssertionError("No LLM response fixture left")
        return self.responses.pop(0)


def valid_workflow() -> dict[str, object]:
    return {
        "id": "history-flow",
        "name": "History Flow",
        "schemaVersion": 2,
        "tools": [],
        "nodes": [
            {
                "id": "agent-1",
                "type": "agent",
                "config": {
                    "instruction": "Return a summary.",
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
