import unittest


class DependencyAnalyzerTests(unittest.TestCase):
    def test_tool_argument_dependency_identifies_tool_call(self) -> None:
        from contextos.tool.risk.dependency_analyzer import (
            DependencyAnalyzer,
            ToolCallDependencyInput,
        )

        issues = DependencyAnalyzer().analyze(
            edited_message_id="message-1",
            original_content="order-1",
            edited_content="order-2",
            tool_calls=[
                ToolCallDependencyInput(
                    call_id="tool-call-1",
                    name="orders.lookup",
                    arguments={"order_id": "order-1"},
                    trace_id="trace-1",
                    checkpoint_id="checkpoint-1",
                    message_id="message-2",
                )
            ],
        )

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].issue_type, "tool_argument_dependency")
        self.assertEqual(issues[0].severity, "warning")
        self.assertEqual(issues[0].related_ids, ["tool-call-1", "trace-1", "checkpoint-1", "message-2"])
        self.assertEqual(
            issues[0].evidence,
            {
                "edited_message_id": "message-1",
                "matched_value": "order-1",
                "tool_name": "orders.lookup",
            },
        )

    def test_state_update_referencing_edited_message_creates_issue(self) -> None:
        from contextos.tool.risk.dependency_analyzer import (
            DependencyAnalyzer,
            StateUpdateDependencyInput,
        )

        issues = DependencyAnalyzer().analyze(
            edited_message_id="message-1",
            original_content="Customer is premium",
            edited_content="Customer is standard",
            state_updates=[
                StateUpdateDependencyInput(
                    update_id="state-update-1",
                    source_message_id="message-1",
                    keys=["customer_tier"],
                    trace_id="trace-2",
                    checkpoint_id="checkpoint-2",
                    message_id="message-3",
                )
            ],
        )

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].issue_type, "state_dependency")
        self.assertEqual(issues[0].related_ids, ["state-update-1", "trace-2", "checkpoint-2", "message-3"])
        self.assertEqual(
            issues[0].evidence,
            {
                "edited_message_id": "message-1",
                "source_message_id": "message-1",
                "state_keys": ["customer_tier"],
            },
        )

    def test_graph_node_referencing_edited_message_creates_issue(self) -> None:
        from contextos.tool.risk.dependency_analyzer import (
            DependencyAnalyzer,
            GraphNodeDependencyInput,
        )

        issues = DependencyAnalyzer().analyze(
            edited_message_id="message-1",
            original_content="route to billing",
            edited_content="route to support",
            graph_nodes=[
                GraphNodeDependencyInput(
                    node_id="billing-router",
                    depends_on_message_ids=["message-1"],
                    trace_id="trace-3",
                    checkpoint_id="checkpoint-3",
                    message_id="message-4",
                )
            ],
        )

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].issue_type, "graph_dependency")
        self.assertEqual(issues[0].related_ids, ["billing-router", "trace-3", "checkpoint-3", "message-4"])
        self.assertEqual(
            issues[0].evidence,
            {
                "edited_message_id": "message-1",
                "node_id": "billing-router",
            },
        )

    def test_unrelated_inputs_do_not_force_replay(self) -> None:
        from contextos.tool.risk.dependency_analyzer import (
            DependencyAnalyzer,
            GraphNodeDependencyInput,
            StateUpdateDependencyInput,
            ToolCallDependencyInput,
        )

        issues = DependencyAnalyzer().analyze(
            edited_message_id="message-1",
            original_content="order-1",
            edited_content="order-2",
            tool_calls=[
                ToolCallDependencyInput(
                    call_id="tool-call-1",
                    name="orders.lookup",
                    arguments={"order_id": "order-9"},
                    trace_id="trace-1",
                    checkpoint_id="checkpoint-1",
                    message_id="message-2",
                )
            ],
            state_updates=[
                StateUpdateDependencyInput(
                    update_id="state-update-1",
                    source_message_id="message-9",
                    keys=["customer_tier"],
                    trace_id="trace-2",
                    checkpoint_id="checkpoint-2",
                    message_id="message-3",
                )
            ],
            graph_nodes=[
                GraphNodeDependencyInput(
                    node_id="billing-router",
                    depends_on_message_ids=["message-9"],
                    trace_id="trace-3",
                    checkpoint_id="checkpoint-3",
                    message_id="message-4",
                )
            ],
        )

        self.assertEqual(issues, [])


if __name__ == "__main__":
    unittest.main()
