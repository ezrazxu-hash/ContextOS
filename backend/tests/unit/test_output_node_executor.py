import unittest


class OutputNodeExecutorTests(unittest.TestCase):
    def test_source_value_is_written_to_workflow_output(self) -> None:
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="final", type="output", config={"source": "$state.answer"})

        state = OutputNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"answer": "done"})

        self.assertEqual(state["output"], "done")

    def test_missing_source_raises_structured_error(self) -> None:
        from contextos.runtime.graph.nodes.output import OutputNodeExecutionError, OutputNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="final", type="output", config={"source": "$state.answer"})

        with self.assertRaises(OutputNodeExecutionError) as error:
            OutputNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({})

        self.assertEqual(error.exception.code, "output.source_missing")
        self.assertEqual(error.exception.node_id, "final")

    def test_non_string_source_value_is_preserved(self) -> None:
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="final", type="output", config={"source": "$state.result"})
        result = {"summary": "ok", "count": 2}

        state = OutputNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"result": result})

        self.assertEqual(state["output"], result)

    def test_source_accepts_structured_node_output_reference(self) -> None:
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="final", type="output", config={"source": {"type": "node_output", "node_id": "planner", "port": "response"}})

        state = OutputNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"__planner_response": "done"})

        self.assertEqual(state["output"], "done")

    def test_runtime_events_are_appended(self) -> None:
        from contextos.runtime.graph.nodes.output import OutputNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec

        node = NodeSpec(id="final", type="output", config={"source": "$state.answer"})

        state = OutputNodeExecutor().build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"answer": "done"})

        self.assertEqual([event["type"] for event in state["runtime_events"]], ["node_started", "node_finished"])


if __name__ == "__main__":
    unittest.main()
