import json
import unittest


class OpenAICompatibleAdapterTests(unittest.TestCase):
    def test_system_user_assistant_sequence_compiles_to_roles(self) -> None:
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter
        from contextos.provider.base.ir import AssistantMessage, SystemInstruction, UserMessage

        adapter = OpenAICompatibleAdapter()

        payload = [
            adapter.compile_message(SystemInstruction("policy")),
            adapter.compile_message(UserMessage("hello")),
            adapter.compile_message(AssistantMessage("hi")),
        ]

        self.assertEqual([message["role"] for message in payload], ["system", "user", "assistant"])
        self.assertEqual(payload[0]["content"], "policy")
        self.assertEqual(payload[2]["content"], "hi")

    def test_tool_call_and_result_preserve_association(self) -> None:
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter
        from contextos.provider.base.ir import AssistantMessage, ToolCall, ToolResult

        adapter = OpenAICompatibleAdapter()
        tool_call = ToolCall(call_id="call-1", name="lookup", arguments={"order": "A-42"})

        assistant_payload = adapter.compile_message(AssistantMessage("checking", [tool_call]))
        result_payload = adapter.compile_tool_result(ToolResult(call_id="call-1", content={"status": "shipped"}))

        self.assertEqual(assistant_payload["tool_calls"][0]["id"], "call-1")
        self.assertEqual(assistant_payload["tool_calls"][0]["function"]["name"], "lookup")
        self.assertEqual(json.loads(assistant_payload["tool_calls"][0]["function"]["arguments"]), {"order": "A-42"})
        self.assertEqual(result_payload["role"], "tool")
        self.assertEqual(result_payload["tool_call_id"], "call-1")

    def test_placeholder_maps_to_legal_message_without_raw_content(self) -> None:
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter
        from contextos.provider.base.ir import ContextPlaceholder

        adapter = OpenAICompatibleAdapter()
        payload = adapter.compile_placeholder(
            ContextPlaceholder(
                placeholder_id="ph-1",
                group_id="group-1",
                summary="Prior tool interaction summarized",
                restorable=True,
                placeholder_type="TOOL_INTERACTION",
                source_count=2,
                original_tokens=500,
                current_tokens=4,
                reason="budget",
            )
        )

        self.assertEqual(payload["role"], "system")
        self.assertIn("context-placeholder", payload["content"])
        self.assertIn("Prior tool interaction summarized", payload["content"])
        self.assertNotIn("raw_content", payload["content"])

    def test_illegal_tool_sequence_returns_validation_issue(self) -> None:
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter
        from contextos.provider.base.ir import AssistantMessage, ToolCall, ToolResult

        adapter = OpenAICompatibleAdapter()
        issues = adapter.validate_sequence(
            [
                AssistantMessage("checking", [ToolCall(call_id="call-1", name="lookup")]),
                ToolResult(call_id="call-x", content="wrong"),
            ]
        )

        self.assertEqual([issue.code for issue in issues], ["unknown_tool_call", "missing_tool_result"])


if __name__ == "__main__":
    unittest.main()
