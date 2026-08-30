import unittest


class NodeCatalogTests(unittest.TestCase):
    def test_catalog_returns_all_v1_runtime_nodes_once(self) -> None:
        from contextos.template.node_catalog import list_node_catalog

        catalog = list_node_catalog()

        self.assertEqual(
            [node["type"] for node in catalog],
            ["START", "END", "llm", "agent", "tool", "condition", "router", "output"],
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

    def test_catalog_excludes_frontend_only_or_legacy_placeholder_nodes(self) -> None:
        from contextos.template.node_catalog import list_node_catalog

        node_types = {node["type"] for node in list_node_catalog()}

        self.assertFalse({"prompt", "subgraph", "human_approval", "context_operator", "memory", "custom"} & node_types)

    def test_catalog_required_fields_match_v1_executable_node_configs(self) -> None:
        from contextos.template.node_catalog import list_node_catalog

        by_type = {node["type"]: node for node in list_node_catalog()}

        self.assertEqual(by_type["llm"]["required_fields"], ["config.prompt_template", "config.output_key"])
        self.assertEqual(by_type["agent"]["required_fields"], ["config.instruction", "config.output_key"])
        self.assertEqual(by_type["tool"]["required_fields"], ["config.tool_name", "config.output_key"])
        self.assertEqual(by_type["condition"]["required_fields"], ["config.state_key"])
        self.assertEqual(by_type["router"]["required_fields"], ["config.state_key"])
        self.assertEqual(by_type["output"]["required_fields"], ["config.source"])


if __name__ == "__main__":
    unittest.main()
