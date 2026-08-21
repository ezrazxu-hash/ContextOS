from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ContextItemTests(unittest.TestCase):
    def test_context_item_type_and_state_cover_prd_values(self) -> None:
        from contextos.context.model.enums import ContextItemState, ContextItemType

        self.assertEqual(
            {item_type.value for item_type in ContextItemType},
            {"MESSAGE", "TOOL_CALL", "TOOL_RESULT", "SUMMARY", "MEMORY", "RESOURCE", "SYSTEM", "PLACEHOLDER"},
        )
        self.assertEqual(
            {state.value for state in ContextItemState},
            {"RAW", "ABSTRACT", "REFERENCE", "EVICTED", "PINNED"},
        )

    def test_user_override_has_highest_effective_content_priority(self) -> None:
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.model.item import ContextItem

        item = ContextItem(
            id="item-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_id="group-1",
            type=ContextItemType.MESSAGE,
            state=ContextItemState.ABSTRACT,
            raw_content="raw",
            generated_content="generated",
            user_override="override",
            source_ids=[],
            token_count_raw=3,
            token_count_effective=1,
            priority=0,
            restorable=True,
        )

        self.assertEqual(item.effective_content, "override")

    def test_generated_content_is_used_before_raw_content(self) -> None:
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.model.item import ContextItem

        item = ContextItem(
            id="item-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_id="group-1",
            type=ContextItemType.SUMMARY,
            state=ContextItemState.ABSTRACT,
            raw_content="raw",
            generated_content="generated",
            user_override=None,
            source_ids=[],
            token_count_raw=3,
            token_count_effective=1,
            priority=0,
            restorable=True,
        )

        self.assertEqual(item.effective_content, "generated")

    def test_state_transition_preserves_raw_content(self) -> None:
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.model.item import ContextItem

        item = ContextItem(
            id="item-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_id="group-1",
            type=ContextItemType.MESSAGE,
            state=ContextItemState.RAW,
            raw_content="immutable raw",
            generated_content=None,
            user_override=None,
            source_ids=[],
            token_count_raw=2,
            token_count_effective=2,
            priority=0,
            restorable=True,
        )

        evicted = item.with_state(ContextItemState.EVICTED)

        self.assertEqual(evicted.state, ContextItemState.EVICTED)
        self.assertEqual(evicted.raw_content, "immutable raw")
        self.assertEqual(item.raw_content, "immutable raw")


if __name__ == "__main__":
    unittest.main()
