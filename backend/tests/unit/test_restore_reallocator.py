import unittest


def make_item(item_id: str, group_id: str, state, tokens: int):
    from contextos.context.model.enums import ContextItemType
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id=item_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_id=group_id,
        type=ContextItemType.MESSAGE,
        state=state,
        raw_content=f"{group_id} raw",
        generated_content=None,
        user_override=None,
        source_ids=[],
        token_count_raw=tokens,
        token_count_effective=tokens,
        priority=0,
        restorable=True,
    )


def make_group(group_id: str, item_id: str, state, tokens: int, summary=None):
    from contextos.context.group.model import ContextGroup, ContextGroupType

    return ContextGroup(
        id=group_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_type=ContextGroupType.MESSAGE_GROUP,
        item_ids=[item_id],
        atomic=False,
        state=state,
        summary=summary,
        placeholder=None,
        source_token_count=tokens,
        effective_token_count=tokens if state.value != "EVICTED" else 0,
        restorable=True,
        dependencies=[],
    )


def create_group_service(groups):
    from contextos.context.group.service import ContextGroupService
    from contextos.context.revision.repository import InMemoryContextRevisionRepository
    from contextos.context.revision.service import ContextRevisionService

    items = {item.id: item for item, _group in groups}
    group_map = {group.id: group for _item, group in groups}
    revision_service = ContextRevisionService(InMemoryContextRevisionRepository())
    return ContextGroupService(items, group_map, revision_service), revision_service


class RestoreReallocatorTests(unittest.TestCase):
    def test_restore_over_budget_evicts_low_value_group_before_restore(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.reallocator import RestoreReallocator, RestoreReallocationRequest
        from contextos.context.revision.model import RevisionType

        group_service, revision_service = create_group_service(
            [
                (make_item("pinned-item", "pinned", ContextItemState.PINNED, 60000), make_group("pinned", "pinned-item", ContextItemState.PINNED, 60000)),
                (make_item("current-item", "current", ContextItemState.RAW, 30000), make_group("current", "current-item", ContextItemState.RAW, 30000)),
                (make_item("old-item", "old", ContextItemState.RAW, 20000), make_group("old", "old-item", ContextItemState.RAW, 20000, summary="old summary")),
                (make_item("restore-item", "restore", ContextItemState.EVICTED, 30000), make_group("restore", "restore-item", ContextItemState.EVICTED, 30000)),
            ]
        )
        reallocator = RestoreReallocator(group_service)

        plan = reallocator.plan(
            RestoreReallocationRequest(
                target_group_id="restore",
                max_tokens=128000,
                protected_group_ids=["current"],
                actor="agent",
            )
        )

        self.assertEqual(plan.evict_group_ids, ["old"])
        self.assertFalse(plan.budget_pressure)
        self.assertEqual(group_service.groups["old"].state, ContextItemState.RAW)

        result = reallocator.apply(plan)

        self.assertEqual(result.status, "restored")
        self.assertLessEqual(result.final_tokens, 128000)
        self.assertEqual(group_service.groups["old"].state, ContextItemState.EVICTED)
        self.assertEqual(group_service.groups["restore"].state, ContextItemState.RAW)
        self.assertIn("restore_planned", result.trace_events)
        self.assertEqual(revision_service.list_revisions("old-item")[0].revision_type, RevisionType.SYSTEM_EVICT)
        self.assertEqual(revision_service.list_revisions("restore-item")[0].revision_type, RevisionType.AGENT_RESTORE)

    def test_no_evict_space_does_not_break_existing_context(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.reallocator import RestoreReallocator, RestoreReallocationRequest

        group_service, _ = create_group_service(
            [
                (make_item("pinned-item", "pinned", ContextItemState.PINNED, 110000), make_group("pinned", "pinned-item", ContextItemState.PINNED, 110000)),
                (make_item("restore-item", "restore", ContextItemState.EVICTED, 30000), make_group("restore", "restore-item", ContextItemState.EVICTED, 30000)),
            ]
        )
        reallocator = RestoreReallocator(group_service)

        plan = reallocator.plan(
            RestoreReallocationRequest(
                target_group_id="restore",
                max_tokens=128000,
                protected_group_ids=[],
                actor="agent",
            )
        )
        result = reallocator.apply(plan)

        self.assertTrue(plan.budget_pressure)
        self.assertEqual(result.status, "rejected")
        self.assertEqual(group_service.groups["pinned"].state, ContextItemState.PINNED)
        self.assertEqual(group_service.groups["restore"].state, ContextItemState.EVICTED)

    def test_apply_failure_rolls_back_context_state(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.reallocator import RestoreReallocator, RestoreReallocationRequest

        group_service, _ = create_group_service(
            [
                (make_item("old-item", "old", ContextItemState.RAW, 20000), make_group("old", "old-item", ContextItemState.RAW, 20000, summary="old summary")),
                (make_item("restore-item", "restore", ContextItemState.EVICTED, 30000), make_group("restore", "restore-item", ContextItemState.EVICTED, 30000)),
            ]
        )
        original_restore = group_service.restore_group

        def fail_restore(*args, **kwargs):
            raise RuntimeError("restore failed")

        group_service.restore_group = fail_restore
        reallocator = RestoreReallocator(group_service)
        plan = reallocator.plan(
            RestoreReallocationRequest(
                target_group_id="restore",
                max_tokens=40000,
                protected_group_ids=[],
                actor="agent",
            )
        )

        result = reallocator.apply(plan)

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.reason, "restore failed")
        self.assertEqual(group_service.groups["old"].state, ContextItemState.RAW)
        self.assertEqual(group_service.groups["restore"].state, ContextItemState.EVICTED)
        group_service.restore_group = original_restore


if __name__ == "__main__":
    unittest.main()
