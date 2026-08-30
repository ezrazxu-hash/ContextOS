import unittest


class GraphCompileServiceTests(unittest.TestCase):
    def test_valid_manifest_compiles_and_runs(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.compile_service import GraphCompileService
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(manifest_payload())

        graph = GraphCompileService().compile(manifest, node_executor_registry=step_registry())
        state = graph.run({}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(state["visited_nodes"], ["writer"])

    def test_invalid_manifest_compile_failure_is_wrapped(self) -> None:
        from contextos.template.compiler.compile_service import GraphCompileError, GraphCompileService
        from contextos.template.manifest.parser import parse_manifest

        payload = manifest_payload()
        payload["graph"]["edges"] = []
        manifest = parse_manifest(payload)

        with self.assertRaises(GraphCompileError) as error:
            GraphCompileService().compile(manifest, node_executor_registry=step_registry())

        self.assertEqual(error.exception.code, "missing_start_edge")
        self.assertEqual(error.exception.field_path, "graph.edges")

    def test_compile_does_not_modify_manifest(self) -> None:
        from contextos.template.compiler.compile_service import GraphCompileService
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(manifest_payload())
        before = manifest.to_dict()

        GraphCompileService().compile(manifest, node_executor_registry=step_registry())

        self.assertEqual(manifest.to_dict(), before)

    def test_same_manifest_repeated_compile_has_same_semantics(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.compile_service import GraphCompileService
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(manifest_payload())
        service = GraphCompileService()

        first = service.compile(manifest, node_executor_registry=step_registry()).run(
            {},
            RuntimeContext("session-1", "timeline-1", "trace-1"),
        )
        second = service.compile(manifest, node_executor_registry=step_registry()).run(
            {},
            RuntimeContext("session-1", "timeline-1", "trace-1"),
        )

        self.assertEqual(first, second)


def manifest_payload() -> dict[str, object]:
    return {
        "template": {"id": "workflow", "name": "Workflow", "version": "1.0.0"},
        "graph": {
            "state_schema": "default_chat_state",
            "nodes": [{"id": "writer", "type": "step", "config": {}}],
            "edges": [{"from": "START", "to": "writer"}, {"from": "writer", "to": "END"}],
        },
        "context": {
            "policy": "balanced",
            "budget": {"high_watermark": 0.8, "target_watermark": 0.65},
            "restore": {"mode": "auto", "max_tokens_per_restore": 12000, "max_restore_per_turn": 3},
        },
        "checkpoint": {"enabled": True},
        "ui": {"editable_messages": True, "expose_context_panel": True},
    }


def step_registry():
    class Executor:
        node_type = "step"

        def build(self, node, runtime_context):
            del runtime_context

            def run(state):
                return {**state, "visited_nodes": [*state.get("visited_nodes", []), node.id]}

            return run

    class Registry:
        def get(self, node_type: str):
            if node_type != "step":
                raise AssertionError(f"Unexpected executor lookup: {node_type}")
            return Executor()

    return Registry()


if __name__ == "__main__":
    unittest.main()
