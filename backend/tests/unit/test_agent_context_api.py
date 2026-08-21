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


def make_group():
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
        source_token_count=500,
        effective_token_count=0,
        restorable=True,
        dependencies=[],
    )


def create_api(mode, restore_count=0, max_restore_per_turn=3):
    from contextos.context.group.service import ContextGroupService
    from contextos.context.restore.agent_api import AgentContextAPI
    from contextos.context.restore.policy import RestorePolicy
    from contextos.context.restore.service import ContextRestoreService, RestoreTurnState
    from contextos.context.revision.repository import InMemoryContextRevisionRepository
    from contextos.context.revision.service import ContextRevisionService
    from contextos.runtime.graph.runtime_context import RuntimeContext

    item = make_item()
    group = make_group()
    revision_service = ContextRevisionService(InMemoryContextRevisionRepository())
    group_service = ContextGroupService({"item-1": item}, {"group-1": group}, revision_service)
    runtime_context = RuntimeContext(session_id="session-1", timeline_id="timeline-1", trace_id="trace-1")
    api = AgentContextAPI(
        groups=[group],
        restore_service=ContextRestoreService(group_service),
        restore_policy=RestorePolicy(mode=mode, max_tokens_per_restore=1000, max_restore_per_turn=max_restore_per_turn),
        turn_state=RestoreTurnState(restore_count=restore_count),
        runtime_context=runtime_context,
    )
    return api, group_service, runtime_context


class AgentContextAPITests(unittest.TestCase):
    def test_auto_restore_restores_and_continues_current_run(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.policy import RestoreMode

        api, group_service, _ = create_api(RestoreMode.AUTO)

        result = api.restore("group-1", token_count=500)

        self.assertEqual(result.status, "restored")
        self.assertEqual(result.continue_run, True)
        self.assertEqual(group_service.groups["group-1"].state, ContextItemState.RAW)
        self.assertEqual(result.trace_events, ["agent_restore_requested:group-1", "agent_restore_restored:group-1"])

    def test_ask_restore_pauses_before_state_change(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.policy import RestoreMode

        api, group_service, _ = create_api(RestoreMode.ASK)

        result = api.restore("group-1", token_count=500)

        self.assertEqual(result.status, "pending_approval")
        self.assertEqual(result.pending_approval, True)
        self.assertEqual(result.continue_run, False)
        self.assertEqual(group_service.groups["group-1"].state, ContextItemState.EVICTED)

    def test_per_turn_limit_is_enforced(self) -> None:
        from contextos.context.restore.policy import RestoreMode

        api, _group_service, _ = create_api(RestoreMode.AUTO, restore_count=1, max_restore_per_turn=1)

        result = api.restore("group-1", token_count=500)

        self.assertEqual(result.status, "rejected")
        self.assertEqual(result.reason, "max_restore_per_turn_exceeded")
        self.assertEqual(result.continue_run, False)

    def test_runtime_context_injects_api_without_exposing_group_state(self) -> None:
        from contextos.context.restore.policy import RestoreMode

        api, _group_service, runtime_context = create_api(RestoreMode.AUTO)
        injected = runtime_context.with_context_api(api)

        self.assertEqual(api.search("Kingbase")[0].group_id, "group-1")
        self.assertFalse(hasattr(api, "groups"))
        self.assertIs(injected.context_api, api)


if __name__ == "__main__":
    unittest.main()
