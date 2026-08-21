from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class AgentStepAndApprovalGrouperTests(unittest.TestCase):
    def test_same_node_events_form_one_agent_step_group(self) -> None:
        from contextos.context.group.agent_step_grouper import group_agent_step_events

        groups = group_agent_step_events(
            [
                {"id": "model-1", "kind": "model_call", "node_execution_id": "node-1"},
                {"id": "tool-call-1", "kind": "tool_call", "node_execution_id": "node-1"},
                {"id": "state-1", "kind": "state_update", "node_execution_id": "node-1"},
                {"id": "assistant-1", "kind": "assistant_message", "node_execution_id": "node-1"},
            ]
        )

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].node_execution_id, "node-1")
        self.assertEqual(groups[0].item_ids, ["model-1", "tool-call-1", "state-1", "assistant-1"])
        self.assertEqual(groups[0].event_kinds, ["model_call", "tool_call", "state_update", "assistant_message"])

    def test_different_nodes_do_not_merge(self) -> None:
        from contextos.context.group.agent_step_grouper import group_agent_step_events

        groups = group_agent_step_events(
            [
                {"id": "model-1", "kind": "model_call", "node_execution_id": "node-1"},
                {"id": "model-2", "kind": "model_call", "node_execution_id": "node-2"},
            ]
        )

        self.assertEqual([group.node_execution_id for group in groups], ["node-1", "node-2"])
        self.assertEqual([group.item_ids for group in groups], [["model-1"], ["model-2"]])

    def test_approval_request_reject_and_related_execution_are_atomic(self) -> None:
        from contextos.context.group.approval_grouper import AtomicApprovalViolation, group_approval_events, validate_approval_atomic_operation

        group = group_approval_events(
            [
                {"id": "request-1", "kind": "approval_request", "approval_id": "approval-1"},
                {"id": "reject-1", "kind": "approval_reject", "approval_id": "approval-1"},
                {"id": "execution-1", "kind": "related_execution", "approval_id": "approval-1"},
            ]
        )[0]

        self.assertTrue(group.complete)
        self.assertTrue(group.atomic)
        self.assertEqual(group.item_ids, ["request-1", "reject-1", "execution-1"])
        with self.assertRaises(AtomicApprovalViolation):
            validate_approval_atomic_operation(group, ["request-1"])


if __name__ == "__main__":
    unittest.main()
