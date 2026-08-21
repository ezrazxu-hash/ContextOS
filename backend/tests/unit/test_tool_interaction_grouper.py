from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ToolInteractionGrouperTests(unittest.TestCase):
    def test_single_tool_call_result_and_continuation_form_complete_group(self) -> None:
        from contextos.context.group.tool_interaction_grouper import group_tool_interactions

        group = group_tool_interactions(
            [
                {"id": "call-a", "kind": "tool_call", "tool_call_id": "A"},
                {"id": "result-a", "kind": "tool_result", "tool_call_id": "A"},
                {"id": "continuation-a", "kind": "assistant_continuation", "tool_call_id": "A"},
            ]
        )

        self.assertTrue(group.complete)
        self.assertTrue(group.legal_for_provider)
        self.assertEqual(group.item_ids, ["call-a", "result-a", "continuation-a"])
        self.assertEqual(group.results_by_call_id["A"], "result-a")
        self.assertEqual(group.continuations_by_call_id["A"], ["continuation-a"])

    def test_multiple_tool_results_pair_by_call_id_when_results_are_out_of_order(self) -> None:
        from contextos.context.group.tool_interaction_grouper import group_tool_interactions

        group = group_tool_interactions(
            [
                {"id": "call-a", "kind": "tool_call", "tool_call_id": "A"},
                {"id": "call-b", "kind": "tool_call", "tool_call_id": "B"},
                {"id": "result-b", "kind": "tool_result", "tool_call_id": "B"},
                {"id": "result-a", "kind": "tool_result", "tool_call_id": "A"},
            ]
        )

        self.assertEqual(group.results_by_call_id, {"A": "result-a", "B": "result-b"})
        self.assertTrue(group.complete)

    def test_missing_result_is_marked_incomplete_without_dropping_call(self) -> None:
        from contextos.context.group.tool_interaction_grouper import group_tool_interactions

        group = group_tool_interactions(
            [
                {"id": "call-a", "kind": "tool_call", "tool_call_id": "A"},
                {"id": "call-b", "kind": "tool_call", "tool_call_id": "B"},
                {"id": "result-a", "kind": "tool_result", "tool_call_id": "A"},
            ]
        )

        self.assertFalse(group.complete)
        self.assertFalse(group.legal_for_provider)
        self.assertEqual(group.missing_result_call_ids, ["B"])
        self.assertIn("call-b", group.item_ids)


if __name__ == "__main__":
    unittest.main()
