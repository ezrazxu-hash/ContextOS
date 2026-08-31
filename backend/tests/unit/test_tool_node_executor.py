import unittest


class ToolNodeExecutorTests(unittest.TestCase):
    def test_state_and_constant_args_are_mapped_to_tool_input(self) -> None:
        from contextos.runtime.graph.nodes.tool import ToolNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry

        calls = []

        async def run(args):
            calls.append(args)
            return {"ok": True}

        registry = ToolExecutorRegistry([ToolExecutor("search.lookup", run)])
        node = NodeSpec(
            id="lookup",
            type="tool",
            config={
                "tool_name": "search.lookup",
                "args": {"query": "$state.answer", "limit": 3},
                "output_key": "tool_result",
            },
        )

        ToolNodeExecutor(registry).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"answer": "mars"})

        self.assertEqual(calls, [{"query": "mars", "limit": 3}])

    def test_args_accept_structured_node_output_reference(self) -> None:
        from contextos.runtime.graph.nodes.tool import ToolNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry

        calls = []

        async def run(args):
            calls.append(args)
            return {"ok": True}

        registry = ToolExecutorRegistry([ToolExecutor("search.lookup", run)])
        node = NodeSpec(
            id="lookup",
            type="tool",
            config={
                "tool_name": "search.lookup",
                "args": {"query": {"type": "node_output", "node_id": "planner", "port": "response"}},
            },
        )

        ToolNodeExecutor(registry).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"__planner_response": "mars"})

        self.assertEqual(calls, [{"query": "mars"}])

    def test_tool_call_and_result_events_are_emitted(self) -> None:
        from contextos.runtime.graph.nodes.tool import ToolNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry

        async def run(args):
            return {"value": args["query"]}

        registry = ToolExecutorRegistry([ToolExecutor("search.lookup", run)])
        node = NodeSpec(id="lookup", type="tool", config=tool_config())

        state = ToolNodeExecutor(registry).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"answer": "mars"})

        self.assertEqual([event["type"] for event in state["runtime_events"]], ["tool_call", "tool_result"])
        self.assertEqual(state["runtime_events"][0]["data"]["tool_name"], "search.lookup")
        self.assertEqual(state["runtime_events"][1]["data"]["result"], {"value": "mars"})

    def test_successful_result_is_written_to_output_key(self) -> None:
        from contextos.runtime.graph.nodes.tool import ToolNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry

        async def run(args):
            return {"value": args["query"]}

        registry = ToolExecutorRegistry([ToolExecutor("search.lookup", run)])
        node = NodeSpec(id="lookup", type="tool", config=tool_config(output_key="lookup_result"))

        state = ToolNodeExecutor(registry).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"answer": "mars"})

        self.assertEqual(state["lookup_result"], {"value": "mars"})

    def test_result_is_written_to_generated_node_output_key_without_output_key(self) -> None:
        from contextos.runtime.graph.nodes.tool import ToolNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry

        async def run(args):
            return {"value": args["query"]}

        registry = ToolExecutorRegistry([ToolExecutor("search.lookup", run)])
        node = NodeSpec(id="lookup-tool", type="tool", config={"tool_name": "search.lookup", "args": {"query": "$state.answer"}})

        state = ToolNodeExecutor(registry).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"answer": "mars"})

        self.assertEqual(state["__lookup_tool_result"], {"value": "mars"})

    def test_tool_error_becomes_structured_node_error(self) -> None:
        from contextos.runtime.graph.nodes.tool import ToolNodeExecutionError, ToolNodeExecutor
        from contextos.runtime.graph.runtime_context import RuntimeContext
        from contextos.template.manifest.schema import NodeSpec
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry

        async def run(args):
            del args
            raise RuntimeError("tool down")

        registry = ToolExecutorRegistry([ToolExecutor("search.lookup", run)])
        node = NodeSpec(id="lookup", type="tool", config=tool_config())

        with self.assertRaises(ToolNodeExecutionError) as error:
            ToolNodeExecutor(registry).build(node, RuntimeContext("session-1", "timeline-1", "trace-1"))({"answer": "mars"})

        self.assertEqual(error.exception.code, "tool.execution_failed")
        self.assertEqual(error.exception.node_id, "lookup")
        self.assertEqual(error.exception.tool_name, "search.lookup")


def tool_config(**overrides):
    config = {
        "tool_name": "search.lookup",
        "args": {"query": "$state.answer"},
        "output_key": "tool_result",
    }
    config.update(overrides)
    return config


if __name__ == "__main__":
    unittest.main()
