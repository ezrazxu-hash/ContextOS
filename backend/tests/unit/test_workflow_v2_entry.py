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


if __name__ == "__main__":
    unittest.main()
