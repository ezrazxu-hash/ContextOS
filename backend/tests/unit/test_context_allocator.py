import unittest


def make_group(
    group_id: str,
    state,
    group_type,
    item_ids=None,
    summary=None,
    tokens: int = 100,
):
    from contextos.context.group.model import ContextGroup

    return ContextGroup(
        id=group_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_type=group_type,
        item_ids=item_ids or [f"{group_id}-item"],
        atomic=False,
        state=state,
        summary=summary,
        placeholder=None,
        source_token_count=tokens,
        effective_token_count=tokens,
        restorable=True,
        dependencies=[],
    )


class ContextAllocatorTests(unittest.TestCase):
    def test_pinned_group_is_kept_and_not_mutated(self) -> None:
        from contextos.context.allocator.allocator import ContextAllocator
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState

        pinned = make_group("group-pinned", ContextItemState.PINNED, ContextGroupType.MESSAGE_GROUP)
        summarized = make_group(
            "group-summarized",
            ContextItemState.RAW,
            ContextGroupType.MESSAGE_GROUP,
            summary="Old summary",
        )

        plan = ContextAllocator().plan([pinned, summarized])

        self.assertEqual(plan.keep_group_ids, ["group-pinned"])
        self.assertEqual(plan.evict_group_ids, ["group-summarized"])
        self.assertEqual(pinned.state, ContextItemState.PINNED)
        self.assertEqual(summarized.state, ContextItemState.RAW)

    def test_current_user_message_group_is_kept(self) -> None:
        from contextos.context.allocator.allocator import ContextAllocator
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState

        current_user = make_group(
            "group-current-user",
            ContextItemState.RAW,
            ContextGroupType.MESSAGE_GROUP,
            item_ids=["current-user-item"],
            summary="Summary exists but current user wins",
        )

        plan = ContextAllocator().plan([current_user], current_user_item_id="current-user-item")

        self.assertEqual(plan.keep_group_ids, ["group-current-user"])
        self.assertEqual(plan.evict_group_ids, [])

    def test_summarized_old_group_is_planned_for_evict(self) -> None:
        from contextos.context.allocator.allocator import ContextAllocator
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState

        group = make_group(
            "group-old",
            ContextItemState.RAW,
            ContextGroupType.MESSAGE_GROUP,
            summary="Compact summary already exists",
        )

        plan = ContextAllocator().plan([group])

        self.assertEqual(plan.evict_group_ids, ["group-old"])

    def test_large_tool_result_is_planned_for_abstract(self) -> None:
        from contextos.context.allocator.allocator import ContextAllocator
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState

        tool_group = make_group(
            "group-tool-large",
            ContextItemState.RAW,
            ContextGroupType.TOOL_INTERACTION,
            tokens=12000,
        )

        plan = ContextAllocator().plan([tool_group])

        self.assertEqual(plan.abstract_group_ids, ["group-tool-large"])


if __name__ == "__main__":
    unittest.main()
