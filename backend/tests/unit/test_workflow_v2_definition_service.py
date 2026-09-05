import unittest
from tempfile import TemporaryDirectory


class WorkflowV2DefinitionServiceTests(unittest.TestCase):
    def test_create_then_get_v2_definition_round_trips_required_dto_fields(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService

        service = WorkflowV2DefinitionService()
        created = service.create(
            {
                "id": "support-flow",
                "name": "Support Flow",
                "inputSchema": {"type": "object", "properties": {"message": {"type": "string"}}},
                "outputSchema": {"type": "object", "properties": {"answer": {"type": "string"}}},
                "tools": [{"id": "context.echo"}],
                "nodes": [{"id": "agent-1", "type": "agent", "position": {"x": 1, "y": 2}}],
                "edges": [{"source": "START", "target": "agent-1"}],
                "runtimeLimits": {"maxLlmTurnsPerNode": 10},
            }
        )
        loaded = service.get("support-flow")

        self.assertEqual(created["schemaVersion"], 2)
        self.assertEqual(created["revision"], 1)
        self.assertEqual(loaded, created)
        self.assertEqual(loaded["inputSchema"]["properties"]["message"]["type"], "string")
        self.assertEqual(loaded["tools"], [{"id": "context.echo"}])

    def test_save_draft_rejects_stale_revision(self) -> None:
        from contextos.workflow_v2.application.definitions import RevisionConflictError, WorkflowV2DefinitionService

        service = WorkflowV2DefinitionService()
        created = service.create({"id": "support-flow", "name": "Support Flow"})
        service.save_draft("support-flow", {**created, "nodes": [{"id": "agent-1", "type": "agent"}]}, expected_revision=1)

        with self.assertRaises(RevisionConflictError):
            service.save_draft("support-flow", {**created, "nodes": []}, expected_revision=1)

        self.assertEqual(service.get("support-flow")["nodes"], [{"id": "agent-1", "type": "agent"}])

    def test_definition_draft_persists_through_json_store_reload(self) -> None:
        from contextos.runtime.persistence.json_store import JsonRuntimeStore
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService

        with TemporaryDirectory() as temp_dir:
            path = f"{temp_dir}/runtime-state.json"
            service = WorkflowV2DefinitionService(JsonRuntimeStore(path))
            created = service.create({"id": "support-flow", "name": "Support Flow"})
            service.save_draft("support-flow", {**created, "edges": [{"source": "START", "target": "END"}]}, expected_revision=1)

            reloaded = WorkflowV2DefinitionService(JsonRuntimeStore(path))

            self.assertEqual(reloaded.get("support-flow")["revision"], 2)
            self.assertEqual(reloaded.get("support-flow")["edges"], [{"source": "START", "target": "END"}])

    def test_publish_creates_immutable_versions_and_draft_can_keep_changing(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        service = WorkflowV2DefinitionService()
        created = service.create(valid_definition("First instruction"))

        v1 = service.publish("support-flow", validator=WorkflowV2DefinitionValidator())
        service.save_draft("support-flow", {**created, **valid_definition("Second instruction")}, expected_revision=1)
        v2 = service.publish("support-flow", validator=WorkflowV2DefinitionValidator())

        self.assertEqual(v1["version"], 1)
        self.assertEqual(v2["version"], 2)
        self.assertEqual(v1["definition"]["nodes"][0]["config"]["instruction"], "First instruction")
        self.assertEqual(v2["definition"]["nodes"][0]["config"]["instruction"], "Second instruction")
        self.assertEqual(service.get_version("support-flow", 1)["definition"]["nodes"][0]["config"]["instruction"], "First instruction")
        self.assertEqual([item["version"] for item in service.list_versions("support-flow")], [1, 2])

    def test_publish_rejects_invalid_draft_without_creating_version(self) -> None:
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService, WorkflowV2PublishValidationError
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        service = WorkflowV2DefinitionService()
        service.create({"id": "support-flow", "name": "Support Flow", "nodes": [{"id": "agent-1", "type": "agent"}], "edges": []})

        with self.assertRaises(WorkflowV2PublishValidationError) as error:
            service.publish("support-flow", validator=WorkflowV2DefinitionValidator())

        self.assertEqual(service.list_versions("support-flow"), [])
        self.assertIn("missing_end_node", [item["code"] for item in error.exception.validation["errors"]])

    def test_published_versions_persist_through_json_store_reload(self) -> None:
        from contextos.runtime.persistence.json_store import JsonRuntimeStore
        from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
        from contextos.workflow_v2.application.validation import WorkflowV2DefinitionValidator

        with TemporaryDirectory() as temp_dir:
            path = f"{temp_dir}/runtime-state.json"
            service = WorkflowV2DefinitionService(JsonRuntimeStore(path))
            service.create(valid_definition("Persisted instruction"))
            service.publish("support-flow", validator=WorkflowV2DefinitionValidator())

            reloaded = WorkflowV2DefinitionService(JsonRuntimeStore(path))

            self.assertEqual(reloaded.get_version("support-flow", 1)["definition"]["nodes"][0]["config"]["instruction"], "Persisted instruction")


def valid_definition(instruction: str) -> dict[str, object]:
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
