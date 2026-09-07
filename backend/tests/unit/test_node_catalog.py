import unittest


class NodeCatalogTests(unittest.TestCase):
    def test_catalog_returns_all_v2_runtime_nodes_once(self) -> None:
        from contextos.template.node_catalog import list_node_catalog

        catalog = list_node_catalog()

        self.assertEqual(
            [node["type"] for node in catalog],
            ["agent", "condition", "workflow", "end"],
        )
        self.assertEqual(len({node["type"] for node in catalog}), len(catalog))

    def test_catalog_entries_include_runtime_contract_fields(self) -> None:
        from contextos.template.node_catalog import list_node_catalog

        for node in list_node_catalog():
            self.assertIsInstance(node["display_name"], str)
            self.assertIsInstance(node["ports"]["inputs"], list)
            self.assertIsInstance(node["ports"]["outputs"], list)
            self.assertIsInstance(node["required_fields"], list)
            self.assertIsInstance(node["connectable"], dict)

    def test_catalog_excludes_legacy_workflow_nodes_and_placeholders(self) -> None:
        from contextos.template.node_catalog import list_node_catalog

        node_types = {node["type"] for node in list_node_catalog()}

        self.assertFalse({"START", "END", "prompt", "llm", "tool", "output", "router", "subgraph", "human_approval", "context_operator", "memory", "custom"} & node_types)

    def test_catalog_required_fields_match_v2_executable_node_configs(self) -> None:
        from contextos.template.node_catalog import list_node_catalog

        by_type = {node["type"]: node for node in list_node_catalog()}

        self.assertEqual(by_type["agent"]["required_fields"], ["config.instruction"])
        self.assertEqual(by_type["condition"]["required_fields"], ["config.branches"])
        self.assertEqual(by_type["workflow"]["required_fields"], ["config.workflowId", "config.version"])
        self.assertEqual(by_type["end"]["required_fields"], [])


if __name__ == "__main__":
    unittest.main()
