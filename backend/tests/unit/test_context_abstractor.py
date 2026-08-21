import unittest


def make_item(*, state, generated_content=None, user_override=None):
    from contextos.context.model.enums import ContextItemType
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id="item-1",
        session_id="session-1",
        timeline_id="timeline-1",
        group_id="group-1",
        type=ContextItemType.TOOL_RESULT,
        state=state,
        raw_content="raw tool result with many rows",
        generated_content=generated_content,
        user_override=user_override,
        source_ids=[],
        token_count_raw=6,
        token_count_effective=6,
        priority=0,
        restorable=True,
    )


class ContextAbstractorTests(unittest.TestCase):
    def test_abstracted_item_keeps_raw_and_writes_generated_content(self) -> None:
        from contextos.context.allocator.abstractor import ContextAbstractor
        from contextos.context.model.enums import ContextItemState

        item = make_item(state=ContextItemState.RAW)

        result = ContextAbstractor(lambda raw: f"summary of {raw}").abstract_item(item)

        self.assertTrue(result.changed)
        self.assertEqual(result.item.state, ContextItemState.ABSTRACT)
        self.assertEqual(result.item.raw_content, "raw tool result with many rows")
        self.assertEqual(result.item.generated_content, "summary of raw tool result with many rows")
        self.assertEqual(result.item.effective_content, "summary of raw tool result with many rows")

    def test_failed_abstraction_returns_original_item_unchanged(self) -> None:
        from contextos.context.allocator.abstractor import ContextAbstractor
        from contextos.context.model.enums import ContextItemState

        item = make_item(state=ContextItemState.RAW)

        def fail(_raw):
            raise RuntimeError("provider unavailable")

        result = ContextAbstractor(fail).abstract_item(item)

        self.assertFalse(result.changed)
        self.assertEqual(result.error, "provider unavailable")
        self.assertEqual(result.item, item)
        self.assertEqual(result.item.state, ContextItemState.RAW)

    def test_user_override_remains_effective_content_after_system_summary(self) -> None:
        from contextos.context.allocator.abstractor import ContextAbstractor
        from contextos.context.model.enums import ContextItemState

        item = make_item(state=ContextItemState.RAW, user_override="manual summary")

        result = ContextAbstractor(lambda _raw: "system summary").abstract_item(item)

        self.assertTrue(result.changed)
        self.assertEqual(result.item.generated_content, "system summary")
        self.assertEqual(result.item.user_override, "manual summary")
        self.assertEqual(result.item.effective_content, "manual summary")


if __name__ == "__main__":
    unittest.main()
