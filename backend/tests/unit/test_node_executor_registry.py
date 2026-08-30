import unittest


class NodeExecutorRegistryTests(unittest.TestCase):
    def test_register_get_and_has_executor(self) -> None:
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry

        executor = fake_executor("llm")
        registry = NodeExecutorRegistry()
        registry.register(executor)

        self.assertTrue(registry.has("llm"))
        self.assertIs(registry.get("llm"), executor)

    def test_duplicate_registration_fails(self) -> None:
        from contextos.runtime.graph.nodes.registry import DuplicateNodeExecutorError, NodeExecutorRegistry

        registry = NodeExecutorRegistry()
        registry.register(fake_executor("llm"))

        with self.assertRaises(DuplicateNodeExecutorError):
            registry.register(fake_executor("llm"))

    def test_unknown_node_type_fails_explicitly(self) -> None:
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry, UnknownNodeExecutorError

        with self.assertRaisesRegex(UnknownNodeExecutorError, "missing"):
            NodeExecutorRegistry().get("missing")

    def test_registered_v1_business_node_types_are_enumerable(self) -> None:
        from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry

        registry = NodeExecutorRegistry()
        for node_type in ["prompt", "llm", "tool", "condition", "output"]:
            registry.register(fake_executor(node_type))

        self.assertEqual(registry.node_types(), ["condition", "llm", "output", "prompt", "tool"])


def fake_executor(node_type: str):
    class FakeExecutor:
        def __init__(self) -> None:
            self.node_type = node_type

        def build(self, node, runtime_context):
            del node, runtime_context
            return lambda state: state

    return FakeExecutor()


if __name__ == "__main__":
    unittest.main()
