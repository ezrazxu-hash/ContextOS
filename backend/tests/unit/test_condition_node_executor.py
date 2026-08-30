import unittest


class ConditionNodeExecutorTests(unittest.TestCase):
    def test_supported_operators(self) -> None:
        from contextos.runtime.graph.nodes.condition import ConditionNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        cases = [
            ("eq", "a", "a", "true"),
            ("ne", "a", "b", "true"),
            ("gt", 3, 2, "true"),
            ("gte", 3, 3, "true"),
            ("lt", 2, 3, "true"),
            ("lte", 3, 3, "true"),
            ("exists", "present", None, "true"),
            ("is_empty", "", None, "true"),
            ("is_empty", [], None, "true"),
            ("contains", ["a", "b"], "b", "true"),
            ("is_true", True, None, "true"),
            ("is_false", False, None, "true"),
        ]

        for operator, source_value, expected_value, expected_route in cases:
            with self.subTest(operator=operator):
                node = NodeSpec(id="check", type="condition", config=condition_config(operator, expected_value))
                state = ConditionNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"source": source_value})
                self.assertEqual(state["route"], expected_route)

    def test_false_result_routes_false(self) -> None:
        from contextos.runtime.graph.nodes.condition import ConditionNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="check", type="condition", config=condition_config("eq", "expected"))

        state = ConditionNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"source": "actual"})

        self.assertEqual(state["route"], "false")

    def test_missing_source_raises_structured_error(self) -> None:
        from contextos.runtime.graph.nodes.condition import ConditionNodeExecutionError, ConditionNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="check", type="condition", config=condition_config("eq", "x"))

        with self.assertRaises(ConditionNodeExecutionError) as error:
            ConditionNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({})

        self.assertEqual(error.exception.code, "condition.source_missing")
        self.assertEqual(error.exception.node_id, "check")

    def test_incompatible_types_raise_structured_error(self) -> None:
        from contextos.runtime.graph.nodes.condition import ConditionNodeExecutionError, ConditionNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="check", type="condition", config=condition_config("gt", "x"))

        with self.assertRaises(ConditionNodeExecutionError) as error:
            ConditionNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"source": 1})

        self.assertEqual(error.exception.code, "condition.type_incompatible")
        self.assertEqual(error.exception.node_id, "check")

    def test_runtime_events_include_route(self) -> None:
        from contextos.runtime.graph.nodes.condition import ConditionNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="check", type="condition", config=condition_config("eq", "x"))

        state = ConditionNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"source": "x"})

        self.assertEqual([event["type"] for event in state["runtime_events"]], ["condition_route"])
        self.assertEqual(state["runtime_events"][0]["data"]["route"], "true")


def condition_config(operator: str, value: object) -> dict[str, object]:
    config: dict[str, object] = {
        "source": "$state.source",
        "operator": operator,
        "state_key": "route",
    }
    if value is not None:
        config["value"] = value
    return config


if __name__ == "__main__":
    unittest.main()
