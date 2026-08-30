import asyncio
import unittest


class ToolExecutorRegistryTests(unittest.TestCase):
    def test_register_and_execute_async_tool(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry

        async def run(args):
            return {"value": args["query"]}

        registry = ToolExecutorRegistry()
        registry.register(ToolExecutor(tool_name="search.lookup", run=run, required_args=("query",)))

        result = asyncio.run(registry.execute("search.lookup", {"query": "mars"}))

        self.assertEqual(result, {"value": "mars"})

    def test_unknown_tool_raises_structured_error(self) -> None:
        from contextos.tool.executor_registry import ToolExecutorNotFound, ToolExecutorRegistry

        registry = ToolExecutorRegistry()

        with self.assertRaises(ToolExecutorNotFound) as error:
            registry.get("missing.tool")

        self.assertEqual(error.exception.code, "tool.not_found")
        self.assertEqual(error.exception.tool_name, "missing.tool")

    def test_missing_required_input_raises_structured_error(self) -> None:
        from contextos.tool.executor import ToolExecutor
        from contextos.tool.executor_registry import ToolExecutorRegistry, ToolInputValidationError

        async def run(args):
            return args

        registry = ToolExecutorRegistry()
        registry.register(ToolExecutor(tool_name="search.lookup", run=run, required_args=("query",)))

        with self.assertRaises(ToolInputValidationError) as error:
            asyncio.run(registry.execute("search.lookup", {}))

        self.assertEqual(error.exception.code, "tool.input_missing")
        self.assertEqual(error.exception.tool_name, "search.lookup")
        self.assertEqual(error.exception.field, "args.query")

    def test_fake_read_only_tool_can_execute(self) -> None:
        from contextos.tool.executor import FakeReadOnlyTool
        from contextos.tool.executor_registry import ToolExecutorRegistry

        registry = ToolExecutorRegistry([FakeReadOnlyTool("context.echo").as_executor()])

        result = asyncio.run(registry.execute("context.echo", {"text": "hello"}))

        self.assertEqual(result, {"tool": "context.echo", "args": {"text": "hello"}})


if __name__ == "__main__":
    unittest.main()
