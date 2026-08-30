import unittest


class CompileDryRunTests(unittest.TestCase):
    def test_valid_graph_dry_run_compiles_and_executes_one_path(self) -> None:
        from contextos.template.compiler.dry_run import CompileDryRunService
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            manifest_payload(
                nodes=[
                    {"id": "planner", "type": "llm", "config": {"output_key": "plan"}},
                    {"id": "tool", "type": "tool", "config": {"output_key": "tool_result"}},
                    {"id": "out", "type": "output", "config": {"source": "$state.tool_result"}},
                ],
                edges=[
                    {"from": "START", "to": "planner"},
                    {"from": "planner", "to": "tool"},
                    {"from": "tool", "to": "out"},
                    {"from": "out", "to": "END"},
                ],
            )
        )

        result = CompileDryRunService().run(manifest)

        self.assertTrue(result.success)
        self.assertEqual(result.graph_state["visited_nodes"], ["planner", "tool", "out"])
        self.assertEqual(result.graph_state["output"], {"dry_run": "tool"})

    def test_structure_error_fails_without_compiled_graph(self) -> None:
        from contextos.template.compiler.dry_run import CompileDryRunError, CompileDryRunService
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(manifest_payload(nodes=[], edges=[]))

        with self.assertRaises(CompileDryRunError) as error:
            CompileDryRunService().run(manifest)

        self.assertEqual(error.exception.code, "missing_start_edge")
        self.assertEqual(error.exception.field_path, "graph.edges")

    def test_dry_run_does_not_call_real_provider_or_tool(self) -> None:
        from contextos.template.compiler.dry_run import CompileDryRunService
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            manifest_payload(
                nodes=[
                    {"id": "planner", "type": "llm", "config": {"output_key": "answer"}},
                    {"id": "tool", "type": "tool", "config": {"output_key": "tool_result"}},
                    {"id": "out", "type": "output", "config": {"source": "$state.tool_result"}},
                ],
                edges=[
                    {"from": "START", "to": "planner"},
                    {"from": "planner", "to": "tool"},
                    {"from": "tool", "to": "out"},
                    {"from": "out", "to": "END"},
                ],
            )
        )

        result = CompileDryRunService().run(
            manifest,
            provider_call=lambda: self.fail("provider should not be called"),
            tool_call=lambda: self.fail("tool should not be called"),
        )

        self.assertTrue(result.success)


def manifest_payload(nodes, edges) -> dict[str, object]:
    return {
        "template": {"id": "workflow", "name": "Workflow", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": nodes,
            "edges": edges,
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


if __name__ == "__main__":
    unittest.main()
