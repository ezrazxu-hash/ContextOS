import unittest


class RouterNodeExecutorTests(unittest.TestCase):
    def test_explicit_route_mapping(self) -> None:
        from contextos.runtime.graph.nodes.router import RouterNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="router", type="router", config=router_config())

        state = RouterNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"intent": "billing"})

        self.assertEqual(state["route"], "billing")

    def test_default_route_is_used_for_unknown_source_value(self) -> None:
        from contextos.runtime.graph.nodes.router import RouterNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="router", type="router", config=router_config(default_route="support"))

        state = RouterNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"intent": "unknown"})

        self.assertEqual(state["route"], "support")

    def test_unknown_route_without_default_raises_structured_error(self) -> None:
        from contextos.runtime.graph.nodes.router import RouterNodeExecutionError, RouterNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="router", type="router", config=router_config())

        with self.assertRaises(RouterNodeExecutionError) as error:
            RouterNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"intent": "unknown"})

        self.assertEqual(error.exception.code, "router.route_unknown")
        self.assertEqual(error.exception.node_id, "router")

    def test_missing_source_raises_structured_error(self) -> None:
        from contextos.runtime.graph.nodes.router import RouterNodeExecutionError, RouterNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="router", type="router", config=router_config())

        with self.assertRaises(RouterNodeExecutionError) as error:
            RouterNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({})

        self.assertEqual(error.exception.code, "router.source_missing")
        self.assertEqual(error.exception.node_id, "router")

    def test_runtime_event_includes_selected_route(self) -> None:
        from contextos.runtime.graph.nodes.router import RouterNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="router", type="router", config=router_config())

        state = RouterNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"intent": "support"})

        self.assertEqual([event["type"] for event in state["runtime_events"]], ["router_route"])
        self.assertEqual(state["runtime_events"][0]["data"]["route"], "support")


def router_config(**overrides) -> dict[str, object]:
    config = {
        "source": "$state.intent",
        "routes": {"billing": "billing", "support": "support"},
        "state_key": "route",
    }
    config.update(overrides)
    return config


if __name__ == "__main__":
    unittest.main()
