import unittest


class ReplayDecisionPolicyTests(unittest.TestCase):
    def test_write_reinvoke_without_confirmation_is_rejected(self) -> None:
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.replay.decision import ReplayAction, ReplayDecision
        from contextos.tool.replay.policy import ReplayDecisionPolicy

        result = ReplayDecisionPolicy().evaluate(
            ReplayDecision(tool_call_id="send-email-call", action=ReplayAction.REINVOKE),
            ToolMetadata(
                tool_id="send_email",
                name="Send email",
                side_effect=SideEffect.WRITE,
                idempotent=False,
            ),
        )

        self.assertFalse(result.allowed)
        self.assertFalse(result.should_execute_tool)
        self.assertEqual(result.reason, "confirmation_required")

    def test_use_history_keeps_provenance_and_does_not_execute_tool(self) -> None:
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.replay.decision import ReplayAction, ReplayDecision
        from contextos.tool.replay.policy import ReplayDecisionPolicy

        result = ReplayDecisionPolicy().evaluate(
            ReplayDecision(
                tool_call_id="lookup-call",
                action=ReplayAction.USE_HISTORY,
                provenance={"tool_result_id": "tool-result-1", "timeline_id": "timeline-1"},
            ),
            ToolMetadata(
                tool_id="orders.lookup",
                name="Lookup order",
                side_effect=SideEffect.READ,
                idempotent=True,
            ),
        )

        self.assertTrue(result.allowed)
        self.assertFalse(result.should_execute_tool)
        self.assertEqual(result.reason, "use_history")
        self.assertEqual(result.provenance, {"tool_result_id": "tool-result-1", "timeline_id": "timeline-1"})

    def test_cancel_does_not_execute_tool(self) -> None:
        from contextos.tool.registry.metadata import SideEffect, ToolMetadata
        from contextos.tool.replay.decision import ReplayAction, ReplayDecision
        from contextos.tool.replay.policy import ReplayDecisionPolicy

        result = ReplayDecisionPolicy().evaluate(
            ReplayDecision(tool_call_id="lookup-call", action=ReplayAction.CANCEL),
            ToolMetadata(
                tool_id="orders.lookup",
                name="Lookup order",
                side_effect=SideEffect.READ,
                idempotent=True,
            ),
        )

        self.assertTrue(result.allowed)
        self.assertFalse(result.should_execute_tool)
        self.assertEqual(result.reason, "cancel")


if __name__ == "__main__":
    unittest.main()
