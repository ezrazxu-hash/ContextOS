import unittest


def make_message_item(content: str):
    from contextos.context.model.enums import ContextItemState, ContextItemType
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id="item-1",
        session_id="session-1",
        timeline_id="timeline-1",
        group_id="group-1",
        type=ContextItemType.MESSAGE,
        state=ContextItemState.RAW,
        raw_content=content,
        generated_content=None,
        user_override=None,
        source_ids=[],
        token_count_raw=len(content.split()),
        token_count_effective=len(content.split()),
        priority=0,
        restorable=True,
    )


class ContextCompilerTests(unittest.TestCase):
    def test_complete_dialogue_compiles_to_provider_payload_and_diagnostics(self) -> None:
        from contextos.context.compiler.compiler import CompileRequest, ContextCompiler
        from contextos.provider.base.ir import SystemInstruction
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter

        compiler = ContextCompiler(OpenAICompatibleAdapter())

        result = compiler.compile(
            CompileRequest(
                conversation_items=[SystemInstruction("policy")],
                context_items=[make_message_item("hello world")],
            )
        )

        self.assertTrue(result.allowed)
        self.assertEqual([entry["role"] for entry in result.provider_payload], ["system", "user"])
        self.assertEqual(result.diagnostics["token_budget"]["current_tokens"], 3)
        self.assertEqual(result.validation_issues, [])

    def test_bad_tool_group_fails_before_provider_payload(self) -> None:
        from contextos.context.compiler.compiler import CompileRequest, ContextCompiler
        from contextos.provider.base.ir import AssistantMessage, ToolCall, ToolResult
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter

        class SpyAdapter(OpenAICompatibleAdapter):
            def __init__(self) -> None:
                super().__init__()
                self.compiled = 0

            def compile_message(self, message):
                self.compiled += 1
                return super().compile_message(message)

        adapter = SpyAdapter()
        compiler = ContextCompiler(adapter)

        result = compiler.compile(
            CompileRequest(
                conversation_items=[
                    AssistantMessage("checking", [ToolCall(call_id="call-1", name="lookup")]),
                    ToolResult(call_id="call-x", content="wrong"),
                ],
            )
        )

        self.assertFalse(result.allowed)
        self.assertEqual(result.provider_payload, [])
        self.assertEqual(adapter.compiled, 0)
        self.assertEqual([issue.code for issue in result.validation_issues], ["unknown_tool_call", "missing_tool_result"])

    def test_over_token_budget_fails_before_provider_payload(self) -> None:
        from contextos.context.compiler.compiler import CompileRequest, ContextCompiler
        from contextos.provider.base.ir import UserMessage
        from contextos.provider.base.token_counter import ProviderCapability
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter

        class SpyAdapter(OpenAICompatibleAdapter):
            def __init__(self) -> None:
                super().__init__(ProviderCapability(max_context_tokens=1))
                self.compiled = 0

            def compile_message(self, message):
                self.compiled += 1
                return super().compile_message(message)

        adapter = SpyAdapter()
        compiler = ContextCompiler(adapter)

        result = compiler.compile(CompileRequest(conversation_items=[UserMessage("too many tokens")]))

        self.assertFalse(result.allowed)
        self.assertEqual(result.provider_payload, [])
        self.assertEqual(adapter.compiled, 0)
        self.assertEqual(result.diagnostics["token_budget"]["remaining_tokens"], -2)

    def test_runtime_executor_injects_compiler_result_before_graph_runner(self) -> None:
        from contextos.runtime.checkpoint.service import CheckpointService
        from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
        from contextos.runtime.graph.executor import RuntimeExecutor

        class CompilerSpy:
            def __init__(self) -> None:
                self.seen_state = None

            def compile(self, graph_state):
                self.seen_state = graph_state
                return {"provider_payload": [{"role": "user", "content": "hello"}]}

        class RunnerSpy:
            def __init__(self) -> None:
                self.seen_state = None

            def run(self, graph_state, runtime_context):
                self.seen_state = graph_state
                return graph_state

        compiler = CompilerSpy()
        runner = RunnerSpy()
        executor = RuntimeExecutor(runner, CheckpointService(InMemoryCheckpointStore()), context_compiler=compiler)

        executor.run(
            session_id="session-1",
            timeline_id="timeline-1",
            trace_id="trace-1",
            graph_state={"messages": ["hello"]},
            message_cursor=1,
            context_revision="ctx-rev-1",
        )

        self.assertEqual(compiler.seen_state, {"messages": ["hello"]})
        self.assertEqual(
            runner.seen_state["compiled_context"],
            {"provider_payload": [{"role": "user", "content": "hello"}]},
        )


if __name__ == "__main__":
    unittest.main()
