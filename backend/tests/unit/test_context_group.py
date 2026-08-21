from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ContextGroupTests(unittest.TestCase):
    def test_group_type_covers_v1_values(self) -> None:
        from contextos.context.group.model import ContextGroupType

        self.assertEqual(
            {group_type.value for group_type in ContextGroupType},
            {
                "MESSAGE_GROUP",
                "TOOL_INTERACTION",
                "AGENT_STEP",
                "SUBTASK",
                "RESOURCE_INTERACTION",
                "HUMAN_APPROVAL",
                "CUSTOM_GROUP",
            },
        )

    def test_atomic_tool_group_rejects_single_member_operation(self) -> None:
        from contextos.context.group.invariants import AtomicGroupViolation, validate_atomic_operation
        from contextos.context.group.model import ContextGroup, ContextGroupType
        from contextos.context.model.enums import ContextItemState

        group = ContextGroup(
            id="group-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.TOOL_INTERACTION,
            item_ids=["call-1", "result-1"],
            atomic=True,
            state=ContextItemState.RAW,
            summary=None,
            placeholder=None,
            source_token_count=20,
            effective_token_count=20,
            restorable=True,
            dependencies=[],
        )

        with self.assertRaises(AtomicGroupViolation):
            validate_atomic_operation(group, ["call-1"])

        validate_atomic_operation(group, ["call-1", "result-1"])

    def test_missing_context_item_reference_fails_validation(self) -> None:
        from contextos.context.group.invariants import MissingContextItem, validate_group_references
        from contextos.context.group.model import ContextGroup, ContextGroupType
        from contextos.context.model.enums import ContextItemState

        group = ContextGroup(
            id="group-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.MESSAGE_GROUP,
            item_ids=["item-1", "missing-item"],
            atomic=False,
            state=ContextItemState.RAW,
            summary=None,
            placeholder=None,
            source_token_count=5,
            effective_token_count=5,
            restorable=True,
            dependencies=[],
        )

        with self.assertRaises(MissingContextItem):
            validate_group_references(group, existing_item_ids={"item-1"})

    def test_v1_rejects_free_split_and_merge(self) -> None:
        from contextos.context.group.invariants import UnsupportedGroupMutation, validate_v1_group_mutation

        for operation in ["split", "merge"]:
            with self.assertRaises(UnsupportedGroupMutation):
                validate_v1_group_mutation(operation)


if __name__ == "__main__":
    unittest.main()
