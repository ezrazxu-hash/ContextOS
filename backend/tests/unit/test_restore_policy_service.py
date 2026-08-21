import unittest


def make_item():
    from contextos.context.model.enums import ContextItemState, ContextItemType
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id="item-1",
        session_id="session-1",
        timeline_id="timeline-1",
        group_id="group-1",
        type=ContextItemType.MESSAGE,
        state=ContextItemState.EVICTED,
        raw_content="Kingbase SQL rewrite notes",
        generated_content=None,
        user_override=None,
        source_ids=[],
        token_count_raw=500,
        token_count_effective=0,
        priority=0,
        restorable=True,
    )


def make_group(token_count: int = 500):
    from contextos.context.group.model import ContextGroup, ContextGroupType
    from contextos.context.model.enums import ContextItemState

    return ContextGroup(
        id="group-1",
        session_id="session-1",
        timeline_id="timeline-1",
        group_type=ContextGroupType.MESSAGE_GROUP,
        item_ids=["item-1"],
        atomic=False,
        state=ContextItemState.EVICTED,
        summary="Kingbase SQL summary",
        placeholder=None,
        source_token_count=token_count,
        effective_token_count=0,
        restorable=True,
        dependencies=[],
    )


def create_group_service(token_count: int = 500):
    from contextos.context.group.service import ContextGroupService
    from contextos.context.revision.repository import InMemoryContextRevisionRepository
    from contextos.context.revision.service import ContextRevisionService

    item = make_item()
    group = make_group(token_count)
    revision_service = ContextRevisionService(InMemoryContextRevisionRepository())
    group_service = ContextGroupService({"item-1": item}, {"group-1": group}, revision_service)
    return group_service, revision_service


class RestorePolicyServiceTests(unittest.TestCase):
    def test_manual_mode_does_not_auto_restore(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.policy import RestoreMode, RestorePolicy
        from contextos.context.restore.service import ContextRestoreService, RestoreRequest, RestoreTurnState

        group_service, revision_service = create_group_service()

        result = ContextRestoreService(group_service).request_restore(
            RestoreRequest(group_id="group-1", token_count=500, actor="agent"),
            RestorePolicy(mode=RestoreMode.MANUAL, max_tokens_per_restore=1000, max_restore_per_turn=3),
            RestoreTurnState(),
        )

        self.assertEqual(result.status, "manual_required")
        self.assertEqual(group_service.groups["group-1"].state, ContextItemState.EVICTED)
        self.assertEqual(revision_service.list_revisions("item-1"), [])

    def test_ask_mode_enters_pending_approval(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.policy import RestoreMode, RestorePolicy
        from contextos.context.restore.service import ContextRestoreService, RestoreRequest, RestoreTurnState

        group_service, _ = create_group_service()

        result = ContextRestoreService(group_service).request_restore(
            RestoreRequest(group_id="group-1", token_count=500, actor="agent"),
            RestorePolicy(mode=RestoreMode.ASK, max_tokens_per_restore=1000, max_restore_per_turn=3),
            RestoreTurnState(),
        )

        self.assertEqual(result.status, "pending_approval")
        self.assertEqual(result.pending_approval, True)
        self.assertEqual(group_service.groups["group-1"].state, ContextItemState.EVICTED)

    def test_auto_mode_restores_agent_revision_within_limits(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.policy import RestoreMode, RestorePolicy
        from contextos.context.restore.service import ContextRestoreService, RestoreRequest, RestoreTurnState
        from contextos.context.revision.model import RevisionType

        group_service, revision_service = create_group_service()
        turn_state = RestoreTurnState()

        result = ContextRestoreService(group_service).request_restore(
            RestoreRequest(group_id="group-1", token_count=500, actor="agent"),
            RestorePolicy(mode=RestoreMode.AUTO, max_tokens_per_restore=1000, max_restore_per_turn=3),
            turn_state,
        )

        self.assertEqual(result.status, "restored")
        self.assertEqual(group_service.groups["group-1"].state, ContextItemState.RAW)
        self.assertEqual(turn_state.restore_count, 1)
        self.assertEqual(revision_service.list_revisions("item-1")[0].revision_type, RevisionType.AGENT_RESTORE)

    def test_restore_count_limit_rejects_auto_restore(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.policy import RestoreMode, RestorePolicy
        from contextos.context.restore.service import ContextRestoreService, RestoreRequest, RestoreTurnState

        group_service, _ = create_group_service()

        result = ContextRestoreService(group_service).request_restore(
            RestoreRequest(group_id="group-1", token_count=500, actor="agent"),
            RestorePolicy(mode=RestoreMode.AUTO, max_tokens_per_restore=1000, max_restore_per_turn=1),
            RestoreTurnState(restore_count=1),
        )

        self.assertEqual(result.status, "rejected")
        self.assertEqual(result.reason, "max_restore_per_turn_exceeded")
        self.assertEqual(group_service.groups["group-1"].state, ContextItemState.EVICTED)

    def test_restore_token_limit_rejects_auto_restore(self) -> None:
        from contextos.context.restore.policy import RestoreMode, RestorePolicy
        from contextos.context.restore.service import ContextRestoreService, RestoreRequest, RestoreTurnState

        group_service, _ = create_group_service(token_count=2000)

        result = ContextRestoreService(group_service).request_restore(
            RestoreRequest(group_id="group-1", token_count=2000, actor="agent"),
            RestorePolicy(mode=RestoreMode.AUTO, max_tokens_per_restore=1000, max_restore_per_turn=3),
            RestoreTurnState(),
        )

        self.assertEqual(result.status, "rejected")
        self.assertEqual(result.reason, "max_tokens_per_restore_exceeded")


if __name__ == "__main__":
    unittest.main()
