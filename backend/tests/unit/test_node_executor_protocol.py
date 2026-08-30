import unittest


class NodeExecutorProtocolTests(unittest.TestCase):
    def test_fake_executor_builds_callable_and_executes_state(self) -> None:
        from contextos.runtime.graph.nodes.protocol import NodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        class FakeExecutor:
            node_type = "fake"

            def build(self, node: NodeSpec, runtime_context: RuntimeContext):
                def run(state):
                    return {**state, "visited_nodes": [*state.get("visited_nodes", []), node.id]}

                return run

        executor = FakeExecutor()
        node = NodeSpec(id="fake-1", type="fake")
        runtime_context = RuntimeContext(session_id="session-1", timeline_id="timeline-1", trace_id="trace-1")

        self.assertIsInstance(executor, NodeExecutor)
        self.assertEqual(executor.build(node, runtime_context)({}), {"visited_nodes": ["fake-1"]})


if __name__ == "__main__":
    unittest.main()
