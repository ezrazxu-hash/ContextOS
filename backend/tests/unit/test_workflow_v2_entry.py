import unittest


class WorkflowV2EntryTests(unittest.TestCase):
    def test_new_workflow_defaults_to_schema_version_2(self) -> None:
        from contextos.api.routes.workflows import post_workflow

        response = post_workflow({"id": "support-flow", "name": "Support Flow"})

        self.assertEqual(response["status"], 201)
        self.assertEqual(response["body"]["schemaVersion"], 2)
        self.assertEqual(response["body"]["id"], "support-flow")
        self.assertEqual(response["body"]["nodes"], [])
        self.assertEqual(response["body"]["edges"], [])

    def test_missing_schema_version_is_legacy_v1(self) -> None:
        from contextos.workflow_v2.domain.definitions import workflow_schema_version

        self.assertEqual(workflow_schema_version({"id": "legacy-flow"}), 1)

    def test_runtime_router_keeps_v1_on_legacy_runner_and_v2_on_v2_runner(self) -> None:
        from contextos.workflow_v2.runtime.router import WorkflowRuntimeRouter

        class Runner:
            def __init__(self, label: str) -> None:
                self.label = label

        legacy_runner = Runner("legacy")
        v2_runner = Runner("v2")
        router = WorkflowRuntimeRouter(legacy_runner=legacy_runner, v2_runner=v2_runner)

        self.assertIs(router.resolve({"id": "legacy-flow"}), legacy_runner)
        self.assertIs(router.resolve({"id": "agent-flow", "schemaVersion": 2}), v2_runner)

    def test_v2_runner_entry_does_not_accept_legacy_node_types(self) -> None:
        from contextos.workflow_v2.runtime.runner import WorkflowV2Runner

        runner = WorkflowV2Runner()

        with self.assertRaisesRegex(ValueError, "Unsupported V2 workflow node type"):
            runner.validate_entry(
                {
                    "schemaVersion": 2,
                    "nodes": [{"id": "prompt-1", "type": "prompt"}],
                    "edges": [],
                }
            )


if __name__ == "__main__":
    unittest.main()
