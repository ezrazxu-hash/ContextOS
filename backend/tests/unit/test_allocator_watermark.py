import unittest


def make_group(group_id: str, state, group_type, tokens: int, summary=None):
    from contextos.context.group.model import ContextGroup

    return ContextGroup(
        id=group_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_type=group_type,
        item_ids=[f"{group_id}-item"],
        atomic=False,
        state=state,
        summary=summary,
        placeholder=None,
        source_token_count=tokens,
        effective_token_count=tokens,
        restorable=True,
        dependencies=[],
    )


class AllocatorWatermarkTests(unittest.TestCase):
    def test_below_high_watermark_does_not_trigger(self) -> None:
        from contextos.context.allocator.watermark import WatermarkPlanner
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState

        plan = WatermarkPlanner().plan(
            [make_group("group-1", ContextItemState.RAW, ContextGroupType.MESSAGE_GROUP, 790)],
            max_tokens=1000,
        )

        self.assertFalse(plan.triggered)
        self.assertFalse(plan.budget_pressure)
        self.assertEqual(plan.evict_group_ids, [])
        self.assertEqual(plan.abstract_group_ids, [])

    def test_above_high_watermark_plans_down_to_target_with_multiple_groups(self) -> None:
        from contextos.context.allocator.watermark import WatermarkPlanner
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState

        groups = [
            make_group("group-pinned", ContextItemState.PINNED, ContextGroupType.MESSAGE_GROUP, 60000),
            make_group(
                "group-old-summary",
                ContextItemState.RAW,
                ContextGroupType.MESSAGE_GROUP,
                12000,
                summary="Already summarized",
            ),
            make_group("group-large-tool", ContextItemState.RAW, ContextGroupType.TOOL_INTERACTION, 9000),
        ]

        plan = WatermarkPlanner().plan(groups, max_tokens=100000)

        self.assertTrue(plan.triggered)
        self.assertFalse(plan.budget_pressure)
        self.assertEqual(plan.target_tokens, 65000)
        self.assertEqual(plan.planned_tokens, 64500)
        self.assertEqual(plan.evict_group_ids, ["group-old-summary"])
        self.assertEqual(plan.abstract_group_ids, ["group-large-tool"])

    def test_pinned_pressure_returns_budget_pressure(self) -> None:
        from contextos.context.allocator.watermark import WatermarkPlanner
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState

        groups = [
            make_group("group-pinned", ContextItemState.PINNED, ContextGroupType.MESSAGE_GROUP, 70000),
            make_group(
                "group-old-summary",
                ContextItemState.RAW,
                ContextGroupType.MESSAGE_GROUP,
                20000,
                summary="Already summarized",
            ),
        ]

        plan = WatermarkPlanner().plan(groups, max_tokens=100000)

        self.assertTrue(plan.triggered)
        self.assertTrue(plan.budget_pressure)
        self.assertEqual(plan.reason, "cannot_reach_target_watermark")
        self.assertEqual(plan.planned_tokens, 70000)


if __name__ == "__main__":
    unittest.main()
