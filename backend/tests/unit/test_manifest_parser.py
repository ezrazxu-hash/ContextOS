import unittest


def golden_manifest_payload():
    return {
        "template": {"id": "research-agent", "name": "Research Agent", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [
                {
                    "id": "planner",
                    "type": "agent",
                    "config": {"prompt": "prompts/planner", "model": "default", "tools": ["web_search"]},
                },
                {"id": "review", "type": "custom", "extension": "extensions.requirement_review"},
            ],
            "edges": [
                {"from": "START", "to": "planner"},
                {"from": "planner", "to": "review"},
                {"from": "review", "to": "END"},
            ],
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


class ManifestParserTests(unittest.TestCase):
    def test_golden_research_agent_manifest_parses(self) -> None:
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(golden_manifest_payload())

        self.assertEqual(manifest.template.id, "research-agent")
        self.assertEqual(manifest.graph.nodes[0].id, "planner")
        self.assertEqual(manifest.graph.nodes[0].config["tools"], ["web_search"])
        self.assertEqual(manifest.graph.edges[1].source, "planner")
        self.assertEqual(manifest.context.restore.mode, "auto")
        self.assertEqual(manifest.checkpoint.enabled, True)
        self.assertEqual(manifest.ui.editable_messages, True)

    def test_missing_node_id_reports_specific_field(self) -> None:
        from contextos.template.manifest.parser import ManifestParseError, parse_manifest

        payload = golden_manifest_payload()
        del payload["graph"]["nodes"][0]["id"]

        with self.assertRaises(ManifestParseError) as error:
            parse_manifest(payload)

        self.assertEqual(error.exception.field_path, "graph.nodes[0].id")

    def test_v1_parser_rejects_unknown_future_fields(self) -> None:
        from contextos.template.manifest.parser import ManifestParseError, parse_manifest

        payload = golden_manifest_payload()
        payload["graph"]["nodes"][0]["dynamic_import"] = "future.loader"

        with self.assertRaises(ManifestParseError) as error:
            parse_manifest(payload)

        self.assertEqual(error.exception.field_path, "graph.nodes[0].dynamic_import")


if __name__ == "__main__":
    unittest.main()
