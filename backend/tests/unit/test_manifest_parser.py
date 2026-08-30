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


def runtime_manifest_payload():
    return {
        "schema_version": "1.0",
        "runtime": {
            "nodes": [
                {
                    "id": "planner",
                    "type": "llm",
                    "name": "Planner LLM",
                    "config": {"prompt_template": "{{input}}", "output_key": "answer"},
                }
            ],
            "edges": [
                {
                    "id": "edge-start-planner",
                    "source": "START",
                    "target": "planner",
                    "source_handle": None,
                    "target_handle": None,
                    "route": None,
                },
                {
                    "id": "edge-planner-end",
                    "source": "planner",
                    "target": "END",
                    "source_handle": None,
                    "target_handle": None,
                    "route": None,
                },
            ],
        },
        "ui": {
            "nodes": {"planner": {"x": 120, "y": 80, "width": 180, "height": 96}},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
        },
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

    def test_v1_runtime_manifest_round_trips_runtime_and_ui_separately(self) -> None:
        from contextos.template.manifest.parser import parse_manifest

        payload = runtime_manifest_payload()

        manifest = parse_manifest(payload)
        restored = manifest.to_dict()

        self.assertEqual(manifest.schema_version, "1.0")
        self.assertEqual(restored["runtime"], payload["runtime"])
        self.assertEqual(restored["ui"], payload["ui"])
        self.assertIsNone(manifest.graph.nodes[0].position)

    def test_v1_runtime_manifest_rejects_ui_fields_inside_runtime_node(self) -> None:
        from contextos.template.manifest.parser import ManifestParseError, parse_manifest

        payload = runtime_manifest_payload()
        payload["runtime"]["nodes"][0]["x"] = 10

        with self.assertRaises(ManifestParseError) as error:
            parse_manifest(payload)

        self.assertEqual(error.exception.field_path, "runtime.nodes[0].x")

    def test_v1_runtime_manifest_rejects_unknown_schema_version(self) -> None:
        from contextos.template.manifest.parser import ManifestParseError, parse_manifest

        payload = runtime_manifest_payload()
        payload["schema_version"] = "2.0"

        with self.assertRaises(ManifestParseError) as error:
            parse_manifest(payload)

        self.assertEqual(error.exception.field_path, "schema_version")

    def test_v1_runtime_manifest_rejects_duplicate_node_id(self) -> None:
        from contextos.template.manifest.parser import ManifestParseError, parse_manifest

        payload = runtime_manifest_payload()
        payload["runtime"]["nodes"].append(
            {"id": "planner", "type": "output", "name": "Duplicate", "config": {"output_key": "answer"}}
        )

        with self.assertRaises(ManifestParseError) as error:
            parse_manifest(payload)

        self.assertEqual(error.exception.field_path, "runtime.nodes[1].id")


if __name__ == "__main__":
    unittest.main()
