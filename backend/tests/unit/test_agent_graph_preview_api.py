import unittest


class AgentGraphPreviewApiTests(unittest.TestCase):
    def test_preview_returns_backend_parsed_edges_and_execution_order(self) -> None:
        from contextos.api.routes.agents import post_agent_graph_preview
        from contextos.template.extension.registry import ExtensionRegistry
        from contextos.tool.registry.registry import ToolRegistry

        response = post_agent_graph_preview(
            "research-agent",
            manifest_payload(
                nodes=[
                    {"id": "a", "type": "llm", "config": {"output_key": "a"}},
                    {"id": "b", "type": "llm", "config": {"output_key": "b"}},
                    {"id": "c", "type": "output", "config": {"source": "$state.b", "output_key": "b"}},
                ],
                edges=[
                    {"source": "START", "target": "a"},
                    {"source": "a", "target": "b"},
                    {"source": "b", "target": "c"},
                    {"source": "c", "target": "END"},
                ],
            ),
            extension_registry=ExtensionRegistry(),
            tool_registry=ToolRegistry(),
        )

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["valid"], True)
        self.assertEqual(response["body"]["start"], "START")
        self.assertEqual(response["body"]["end"], "END")
        self.assertEqual(response["body"]["execution_order"], ["a", "b", "c"])
        self.assertEqual(
            response["body"]["edges"],
            [
                {"source": "START", "target": "a"},
                {"source": "a", "target": "b"},
                {"source": "b", "target": "c"},
                {"source": "c", "target": "END"},
            ],
        )

    def test_preview_reports_invalid_edge_without_fake_success(self) -> None:
        from contextos.api.routes.agents import post_agent_graph_preview
        from contextos.template.extension.registry import ExtensionRegistry
        from contextos.tool.registry.registry import ToolRegistry

        response = post_agent_graph_preview(
            "research-agent",
            manifest_payload(
                nodes=[{"id": "a", "type": "llm", "config": {"output_key": "a"}}],
                edges=[{"source": "START", "target": "missing"}, {"source": "a", "target": "END"}],
            ),
            extension_registry=ExtensionRegistry(),
            tool_registry=ToolRegistry(),
        )

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["valid"], False)
        self.assertEqual(response["body"]["error"]["code"], "unknown_node")
        self.assertEqual(response["body"]["error"]["field_path"], "graph.edges[0].to")


def manifest_payload(nodes, edges) -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "template": {"id": "research-agent", "name": "Research Agent", "version": "draft"},
        "runtime": {
            "state_schema": "default_chat_state",
            "nodes": nodes,
            "edges": edges,
        },
        "ui": {
            "nodes": {node["id"]: {"position": {"x": index * 160, "y": 80}} for index, node in enumerate(nodes)},
            "viewport": {},
        },
    }


if __name__ == "__main__":
    unittest.main()
