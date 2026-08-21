from pathlib import Path
import json
import unittest

from contextos.provider.base.ir import (
    AssistantMessage,
    ContextPlaceholder,
    ContextReference,
    SystemInstruction,
    ToolCall,
    ToolResult,
    UserMessage,
)


class ContextIRTests(unittest.TestCase):
    def test_ir_items_are_serializable(self) -> None:
        tool_call = ToolCall(call_id="call-1", name="lookup_order", arguments={"id": "A-42"})
        items = [
            SystemInstruction(content="Follow workspace policy."),
            UserMessage(content="Where is order A-42?"),
            AssistantMessage(content="I will check.", tool_calls=[tool_call]),
            ToolResult(call_id="call-1", content={"status": "shipped"}),
            ContextPlaceholder(
                placeholder_id="ph-1",
                group_id="group-1",
                summary="Earlier shipping discussion",
                restorable=True,
            ),
            ContextReference(reference_id="ref-1", target_id="ctx-1", label="shipping context"),
        ]

        serialized = [item.to_dict() for item in items]
        json.dumps(serialized)

        self.assertEqual(serialized[0]["type"], "system_instruction")
        self.assertEqual(serialized[2]["tool_calls"][0]["call_id"], "call-1")
        self.assertEqual(serialized[3]["call_id"], "call-1")
        self.assertEqual(serialized[4]["type"], "context_placeholder")
        self.assertEqual(serialized[5]["type"], "context_reference")

    def test_ir_has_no_provider_sdk_dependency(self) -> None:
        source = Path("backend/src/contextos/provider/base/ir.py").read_text(encoding="utf-8").lower()

        self.assertNotIn("openai", source)
        self.assertNotIn("anthropic", source)

    def test_tool_result_requires_call_id(self) -> None:
        with self.assertRaises(ValueError):
            ToolResult(call_id="", content="missing call id")


if __name__ == "__main__":
    unittest.main()
