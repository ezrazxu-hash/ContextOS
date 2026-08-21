import unittest


class EditImpactAnalyzerTests(unittest.TestCase):
    def test_shipped_tool_result_conflicts_with_refunded_edit(self) -> None:
        from contextos.provider.base.ir import ToolResult
        from contextos.tool.risk.impact_analyzer import EditImpactAnalyzer

        issues = EditImpactAnalyzer().analyze_message_tool_result_conflicts(
            edited_content="订单已经退款。",
            tool_results=[
                ToolResult(
                    call_id="order-status-call",
                    content={"order_id": "order-1", "status": "shipped"},
                )
            ],
        )

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].issue_type, "message_tool_result_conflict")
        self.assertEqual(issues[0].severity, "warning")
        self.assertEqual(issues[0].related_ids, ["order-status-call"])
        self.assertEqual(
            issues[0].evidence,
            {
                "edited_signal": "refunded",
                "tool_result_status": "shipped",
                "tool_result_call_id": "order-status-call",
            },
        )

    def test_matching_plain_message_does_not_create_high_risk_false_positive(self) -> None:
        from contextos.provider.base.ir import ToolResult
        from contextos.tool.risk.impact_analyzer import EditImpactAnalyzer

        issues = EditImpactAnalyzer().analyze_message_tool_result_conflicts(
            edited_content="订单已经发货。",
            tool_results=[
                ToolResult(
                    call_id="order-status-call",
                    content={"order_id": "order-1", "status": "shipped"},
                )
            ],
        )

        self.assertEqual(issues, [])

    def test_uncertain_refund_claim_is_not_marked_safe(self) -> None:
        from contextos.provider.base.ir import ToolResult
        from contextos.tool.risk.impact_analyzer import EditImpactAnalyzer

        issues = EditImpactAnalyzer().analyze_message_tool_result_conflicts(
            edited_content="订单已经退款。",
            tool_results=[
                ToolResult(
                    call_id="order-lookup-call",
                    content={"order_id": "order-1", "state": "external"},
                )
            ],
        )

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].issue_type, "message_tool_result_uncertain")
        self.assertEqual(issues[0].severity, "info")
        self.assertEqual(issues[0].related_ids, ["order-lookup-call"])
        self.assertEqual(
            issues[0].evidence,
            {
                "edited_signal": "refunded",
                "tool_result_call_id": "order-lookup-call",
                "reason": "tool_result_status_unknown",
            },
        )


if __name__ == "__main__":
    unittest.main()
