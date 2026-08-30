import unittest


def base_payload(nodes, edges):
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


class LangGraphManifestCompilerTests(unittest.TestCase):
    def test_start_agent_end_graph_runs(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {
                        "id": "agent",
                        "type": "agent",
                        "config": {"output_key": "answer", "output": "hello from agent"},
                    }
                ],
                edges=[{"from": "START", "to": "agent"}, {"from": "agent", "to": "END"}],
            )
        )

        graph = LangGraphManifestCompiler().compile(manifest)
        state = graph.run({}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(state["answer"], "hello from agent")
        self.assertEqual(state["visited_nodes"], ["agent"])

    def test_router_branch_selects_matching_edge(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {"id": "router", "type": "router", "config": {"state_key": "route"}},
                    {"id": "billing", "type": "output", "config": {"output_key": "team", "output": "billing"}},
                    {"id": "support", "type": "output", "config": {"output_key": "team", "output": "support"}},
                ],
                edges=[
                    {"from": "START", "to": "router"},
                    {"from": "router", "to": "billing", "condition": "billing"},
                    {"from": "router", "to": "support", "condition": "support"},
                    {"from": "billing", "to": "END"},
                    {"from": "support", "to": "END"},
                ],
            )
        )

        graph = LangGraphManifestCompiler().compile(manifest)
        state = graph.run({"route": "support"}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(state["team"], "support")
        self.assertEqual(state["visited_nodes"], ["router", "support"])

    def test_human_approval_node_returns_recoverable_interrupt(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {
                        "id": "approval",
                        "type": "human_approval",
                        "config": {"prompt": "Approve external write?"},
                    }
                ],
                edges=[{"from": "START", "to": "approval"}, {"from": "approval", "to": "END"}],
            )
        )

        graph = LangGraphManifestCompiler().compile(manifest)
        state = graph.run({}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(
            state["interrupt"],
            {
                "node_id": "approval",
                "type": "human_approval",
                "prompt": "Approve external write?",
                "recoverable": True,
            },
        )
        self.assertEqual(state["visited_nodes"], ["approval"])

    def test_start_end_endpoint_graph_runs_without_business_executor(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(base_payload(nodes=[], edges=[{"from": "START", "to": "END"}]))

        graph = LangGraphManifestCompiler().compile(manifest, node_executor_registry=empty_registry())
        state = graph.run({"input": "hello"}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(state, {"input": "hello"})

    def test_compile_rejects_missing_start_or_end(self) -> None:
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest
        from contextos.template.validator.validator import ManifestValidationError

        manifest = parse_manifest(base_payload(nodes=[{"id": "writer", "type": "output", "config": {}}], edges=[]))

        with self.assertRaises(ManifestValidationError) as error:
            LangGraphManifestCompiler().compile(manifest, node_executor_registry=empty_registry())

        self.assertEqual(error.exception.code, "missing_start_edge")
        self.assertEqual(error.exception.field_path, "graph.edges")

    def test_start_and_end_are_not_resolved_as_business_executors(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        registry = recording_registry()
        manifest = parse_manifest(
            base_payload(
                nodes=[{"id": "writer", "type": "output", "config": {"output_key": "answer", "output": "ok"}}],
                edges=[{"from": "START", "to": "writer"}, {"from": "writer", "to": "END"}],
            )
        )

        graph = LangGraphManifestCompiler().compile(manifest, node_executor_registry=registry)
        state = graph.run({}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(registry.requested_types, ["output"])
        self.assertEqual(state["visited_nodes"], ["writer"])

    def test_plain_edges_execute_registered_nodes_in_manifest_order(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        registry = step_registry()
        manifest = parse_manifest(
            base_payload(
                nodes=[{"id": "a", "type": "step", "config": {}}, {"id": "b", "type": "step", "config": {}}],
                edges=[{"from": "START", "to": "a"}, {"from": "a", "to": "b"}, {"from": "b", "to": "END"}],
            )
        )

        state = LangGraphManifestCompiler().compile(manifest, node_executor_registry=registry).run(
            {},
            RuntimeContext("session-1", "timeline-1", "trace-1"),
        )

        self.assertEqual(state["visited_nodes"], ["a", "b"])

    def test_compile_rejects_unknown_plain_edge_endpoint(self) -> None:
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest
        from contextos.template.validator.validator import ManifestValidationError

        manifest = parse_manifest(
            base_payload(
                nodes=[{"id": "a", "type": "step", "config": {}}],
                edges=[{"from": "START", "to": "a"}, {"from": "a", "to": "missing"}],
            )
        )

        with self.assertRaises(ManifestValidationError) as error:
            LangGraphManifestCompiler().compile(manifest, node_executor_registry=step_registry())

        self.assertEqual(error.exception.code, "unknown_node")
        self.assertEqual(error.exception.field_path, "graph.edges[1].to")

    def test_compile_rejects_duplicate_plain_edge(self) -> None:
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest
        from contextos.template.validator.validator import ManifestValidationError

        manifest = parse_manifest(
            base_payload(
                nodes=[{"id": "a", "type": "step", "config": {}}],
                edges=[
                    {"from": "START", "to": "a"},
                    {"from": "START", "to": "a"},
                    {"from": "a", "to": "END"},
                ],
            )
        )

        with self.assertRaises(ManifestValidationError) as error:
            LangGraphManifestCompiler().compile(manifest, node_executor_registry=step_registry())

        self.assertEqual(error.exception.code, "duplicate_edge")
        self.assertEqual(error.exception.field_path, "graph.edges[1]")

    def test_conditional_edges_route_true_and_false_paths(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {"id": "check", "type": "condition", "config": {"state_key": "route"}},
                    {"id": "yes", "type": "step", "config": {}},
                    {"id": "no", "type": "step", "config": {}},
                ],
                edges=[
                    {"from": "START", "to": "check"},
                    {"from": "check", "to": "yes", "condition": "true"},
                    {"from": "check", "to": "no", "condition": "false"},
                    {"from": "yes", "to": "END"},
                    {"from": "no", "to": "END"},
                ],
            )
        )
        graph = LangGraphManifestCompiler().compile(manifest, node_executor_registry=condition_registry())

        true_state = graph.run({"flag": True}, RuntimeContext("session-1", "timeline-1", "trace-1"))
        false_state = graph.run({"flag": False}, RuntimeContext("session-1", "timeline-1", "trace-1"))

        self.assertEqual(true_state["visited_nodes"], ["check", "yes"])
        self.assertEqual(false_state["visited_nodes"], ["check", "no"])

    def test_conditional_edge_unknown_route_fails_explicitly(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {"id": "check", "type": "condition", "config": {"state_key": "route"}},
                    {"id": "yes", "type": "step", "config": {}},
                ],
                edges=[
                    {"from": "START", "to": "check"},
                    {"from": "check", "to": "yes", "condition": "true"},
                    {"from": "yes", "to": "END"},
                ],
            )
        )
        graph = LangGraphManifestCompiler().compile(manifest, node_executor_registry=condition_registry(route_override="maybe"))

        with self.assertRaisesRegex(ValueError, "Unknown route 'maybe' from node check"):
            graph.run({"flag": True}, RuntimeContext("session-1", "timeline-1", "trace-1"))

    def test_conditional_edge_rejects_unknown_route_target(self) -> None:
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest
        from contextos.template.validator.validator import ManifestValidationError

        manifest = parse_manifest(
            base_payload(
                nodes=[{"id": "check", "type": "condition", "config": {"state_key": "route"}}],
                edges=[{"from": "START", "to": "check"}, {"from": "check", "to": "missing", "condition": "true"}],
            )
        )

        with self.assertRaises(ManifestValidationError) as error:
            LangGraphManifestCompiler().compile(manifest, node_executor_registry=condition_registry())

        self.assertEqual(error.exception.code, "unknown_node")
        self.assertEqual(error.exception.field_path, "graph.edges[1].to")

    def test_router_node_routes_three_declared_branches(self) -> None:
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {"id": "router", "type": "router", "config": {"state_key": "selected_route"}},
                    {"id": "alpha", "type": "step", "config": {}},
                    {"id": "beta", "type": "step", "config": {}},
                    {"id": "gamma", "type": "step", "config": {}},
                ],
                edges=[
                    {"from": "START", "to": "router"},
                    {"from": "router", "to": "alpha", "condition": "alpha"},
                    {"from": "router", "to": "beta", "condition": "beta"},
                    {"from": "router", "to": "gamma", "condition": "gamma"},
                    {"from": "alpha", "to": "END"},
                    {"from": "beta", "to": "END"},
                    {"from": "gamma", "to": "END"},
                ],
            )
        )
        graph = LangGraphManifestCompiler().compile(manifest, node_executor_registry=router_registry())

        for route, expected in [("alpha", ["router", "alpha"]), ("beta", ["router", "beta"]), ("gamma", ["router", "gamma"])]:
            with self.subTest(route=route):
                state = graph.run({"selected_route": route}, RuntimeContext("session-1", "timeline-1", "trace-1"))
                self.assertEqual(state["visited_nodes"], expected)

    def test_router_node_rejects_duplicate_route_key(self) -> None:
        from contextos.template.compiler.langgraph_compiler import LangGraphManifestCompiler
        from contextos.template.manifest.parser import parse_manifest
        from contextos.template.validator.validator import ManifestValidationError

        manifest = parse_manifest(
            base_payload(
                nodes=[
                    {"id": "router", "type": "router", "config": {"state_key": "selected_route"}},
                    {"id": "alpha", "type": "step", "config": {}},
                    {"id": "beta", "type": "step", "config": {}},
                ],
                edges=[
                    {"from": "START", "to": "router"},
                    {"from": "router", "to": "alpha", "condition": "same"},
                    {"from": "router", "to": "beta", "condition": "same"},
                    {"from": "alpha", "to": "END"},
                    {"from": "beta", "to": "END"},
                ],
            )
        )

        with self.assertRaises(ManifestValidationError) as error:
            LangGraphManifestCompiler().compile(manifest, node_executor_registry=router_registry())

        self.assertEqual(error.exception.code, "duplicate_route")
        self.assertEqual(error.exception.field_path, "graph.edges[2].condition")


if __name__ == "__main__":
    unittest.main()


def empty_registry():
    class EmptyRegistry:
        requested_types: list[str] = []

        def get(self, node_type: str):
            self.requested_types.append(node_type)
            raise AssertionError(f"Unexpected executor lookup: {node_type}")

    return EmptyRegistry()


def recording_registry():
    class Executor:
        node_type = "output"

        def build(self, node, runtime_context):
            del runtime_context

            def run(state):
                return {
                    **state,
                    "visited_nodes": [*state.get("visited_nodes", []), node.id],
                    str(node.config["output_key"]): node.config["output"],
                }

            return run

    class Registry:
        def __init__(self) -> None:
            self.requested_types: list[str] = []

        def get(self, node_type: str):
            self.requested_types.append(node_type)
            if node_type != "output":
                raise AssertionError(f"Unexpected executor lookup: {node_type}")
            return Executor()

    return Registry()


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


def condition_registry(route_override=None):
    class ConditionExecutor:
        node_type = "condition"

        def build(self, node, runtime_context):
            del runtime_context

            def run(state):
                route = route_override if route_override is not None else ("true" if state.get("flag") else "false")
                return {
                    **state,
                    "route": route,
                    "visited_nodes": [*state.get("visited_nodes", []), node.id],
                }

            return run

    class StepExecutor:
        node_type = "step"

        def build(self, node, runtime_context):
            del runtime_context

            def run(state):
                return {**state, "visited_nodes": [*state.get("visited_nodes", []), node.id]}

            return run

    class Registry:
        def get(self, node_type: str):
            if node_type == "condition":
                return ConditionExecutor()
            if node_type == "step":
                return StepExecutor()
            raise AssertionError(f"Unexpected executor lookup: {node_type}")

    return Registry()


def router_registry():
    class RouterExecutor:
        node_type = "router"

        def build(self, node, runtime_context):
            del runtime_context

            def run(state):
                return {
                    **state,
                    "visited_nodes": [*state.get("visited_nodes", []), node.id],
                }

            return run

    class StepExecutor:
        node_type = "step"

        def build(self, node, runtime_context):
            del runtime_context

            def run(state):
                return {**state, "visited_nodes": [*state.get("visited_nodes", []), node.id]}

            return run

    class Registry:
        def get(self, node_type: str):
            if node_type == "router":
                return RouterExecutor()
            if node_type == "step":
                return StepExecutor()
            raise AssertionError(f"Unexpected executor lookup: {node_type}")

    return Registry()
