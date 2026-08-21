from pathlib import Path
import unittest


class ProviderAdapterProtocolTests(unittest.TestCase):
    def test_fake_adapter_can_implement_full_protocol(self) -> None:
        from contextos.context.compiler.tool_validator import ValidationIssue
        from contextos.provider.base.adapter import ProviderAdapter
        from contextos.provider.base.ir import (
            AssistantMessage,
            ContextPlaceholder,
            SystemInstruction,
            ToolCall,
            ToolResult,
        )
        from contextos.provider.base.token_counter import ProviderCapability

        class FakeAdapter:
            def compile_message(self, message):
                return {"message": message.to_dict()}

            def compile_tool_call(self, tool_call: ToolCall):
                return {"tool_call": tool_call.to_dict()}

            def compile_tool_result(self, tool_result: ToolResult):
                return {"tool_result": tool_result.to_dict()}

            def compile_placeholder(self, placeholder: ContextPlaceholder):
                return {"placeholder": placeholder.to_dict()}

            def validate_sequence(self, items):
                return []

            def count_tokens(self, items):
                return 7

            def capability(self):
                return ProviderCapability(max_context_tokens=128)

        adapter = FakeAdapter()

        self.assertIsInstance(adapter, ProviderAdapter)
        self.assertEqual(adapter.compile_message(SystemInstruction("policy"))["message"]["type"], "system_instruction")
        self.assertEqual(adapter.compile_message(AssistantMessage("done"))["message"]["type"], "assistant_message")
        self.assertEqual(adapter.compile_tool_call(ToolCall("call-1", "lookup"))["tool_call"]["call_id"], "call-1")
        self.assertEqual(adapter.compile_tool_result(ToolResult("call-1", "ok"))["tool_result"]["call_id"], "call-1")
        self.assertEqual(
            adapter.compile_placeholder(ContextPlaceholder("ph-1", "group-1", "summary", True))["placeholder"]["type"],
            "context_placeholder",
        )
        self.assertEqual(adapter.validate_sequence([]), [])
        self.assertEqual(adapter.count_tokens([]), 7)
        self.assertEqual(adapter.capability().max_context_tokens, 128)
        self.assertTrue(issubclass(ValidationIssue, object))

    def test_runtime_does_not_import_specific_provider(self) -> None:
        runtime_files = Path("backend/src/contextos/runtime").rglob("*.py")
        runtime_source = "\n".join(path.read_text(encoding="utf-8").lower() for path in runtime_files)

        self.assertNotIn("openai_compatible", runtime_source)
        self.assertNotIn("anthropic", runtime_source)
        self.assertNotIn("gemini", runtime_source)


if __name__ == "__main__":
    unittest.main()
