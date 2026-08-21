from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


def make_item(item_id: str, group_id: str, state, raw_content: str, token_count: int, priority: int = 0):
    from contextos.context.model.enums import ContextItemType
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id=item_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_id=group_id,
        type=ContextItemType.MESSAGE,
        state=state,
        raw_content=raw_content,
        generated_content=None,
        user_override=None,
        source_ids=[],
        token_count_raw=token_count,
        token_count_effective=token_count,
        priority=priority,
        restorable=True,
    )


def make_group(group_id: str, item_ids: list[str], state, summary: str, source_tokens: int, effective_tokens: int, priority: int = 0):
    from contextos.context.group.model import ContextGroup, ContextGroupType

    return ContextGroup(
        id=group_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_type=ContextGroupType.MESSAGE_GROUP,
        item_ids=item_ids,
        atomic=True,
        state=state,
        summary=summary,
        placeholder=None,
        source_token_count=source_tokens,
        effective_token_count=effective_tokens,
        restorable=True,
        dependencies=[],
    )


class MvpRestoreE2ETests(unittest.TestCase):
    def create_group_service(self, *, include_low_value: bool):
        from contextos.context.group.service import ContextGroupService
        from contextos.context.model.enums import ContextItemState
        from contextos.context.revision.repository import InMemoryContextRevisionRepository
        from contextos.context.revision.service import ContextRevisionService

        items = {
            "kingbase-item": make_item(
                "kingbase-item",
                "kingbase-group",
                ContextItemState.EVICTED,
                "Kingbase SQL rewrite details include compatibility casts",
                30,
            )
        }
        groups = {
            "kingbase-group": make_group(
                "kingbase-group",
                ["kingbase-item"],
                ContextItemState.EVICTED,
                "Kingbase SQL rewrite details",
                source_tokens=30,
                effective_tokens=0,
            )
        }
        if include_low_value:
            items["low-value-item"] = make_item(
                "low-value-item",
                "low-value-group",
                ContextItemState.RAW,
                "old debug notes",
                20,
            )
            groups["low-value-group"] = make_group(
                "low-value-group",
                ["low-value-item"],
                ContextItemState.RAW,
                "old debug notes",
                source_tokens=20,
                effective_tokens=20,
            )
        revision_service = ContextRevisionService(InMemoryContextRevisionRepository())
        return ContextGroupService(items, groups, revision_service), revision_service

    def create_agent_api(self, group_service, *, max_tokens: int | None = None):
        from contextos.context.restore.agent_api import AgentContextAPI
        from contextos.context.restore.policy import RestoreMode, RestorePolicy
        from contextos.context.restore.reallocator import RestoreReallocationRequest, RestoreReallocator
        from contextos.context.restore.service import ContextRestoreService, RestoreTurnState
        from contextos.runtime.graph.runtime_context import RuntimeContext

        runtime_context = RuntimeContext(session_id="session-1", timeline_id="timeline-1", trace_id="trace-restore")
        reallocator = None
        if max_tokens is not None:
            restore_reallocator = RestoreReallocator(group_service)

            def reallocator(group_id: str, actor: str):
                plan = restore_reallocator.plan(
                    RestoreReallocationRequest(
                        target_group_id=group_id,
                        max_tokens=max_tokens,
                        protected_group_ids=[],
                        actor=actor,
                    )
                )
                return restore_reallocator.apply(plan)

        return AgentContextAPI(
            groups=list(group_service.groups.values()),
            restore_service=ContextRestoreService(group_service),
            restore_policy=RestorePolicy(RestoreMode.AUTO, max_tokens_per_restore=100, max_restore_per_turn=3),
            turn_state=RestoreTurnState(),
            runtime_context=runtime_context,
            reallocator=reallocator,
        )

    def test_agent_search_hits_evicted_group_and_restores_when_budget_is_enough(self) -> None:
        from contextos.context.model.enums import ContextItemState

        group_service, revisions = self.create_group_service(include_low_value=False)
        agent_api = self.create_agent_api(group_service)

        hits = agent_api.search("Kingbase SQL")
        result = agent_api.restore("kingbase-group", token_count=30)

        self.assertEqual([hit.group_id for hit in hits], ["kingbase-group"])
        self.assertEqual(result.status, "restored")
        self.assertTrue(result.continue_run)
        self.assertEqual(group_service.groups["kingbase-group"].state, ContextItemState.RAW)
        self.assertEqual(group_service.items["kingbase-item"].state, ContextItemState.RAW)
        self.assertEqual(revisions.list_revisions("kingbase-item")[0].revision_type.value, "AGENT_RESTORE")
        self.assertEqual(result.trace_events, ["agent_restore_requested:kingbase-group", "agent_restore_restored:kingbase-group"])

    def test_budget_pressure_evicts_low_value_group_before_restore_and_final_payload_is_in_budget(self) -> None:
        from contextos.context.compiler.compiler import CompileRequest, ContextCompiler
        from contextos.context.model.enums import ContextItemState
        from contextos.provider.base.token_counter import ProviderCapability
        from contextos.provider.openai_compatible.adapter import OpenAICompatibleAdapter

        group_service, revisions = self.create_group_service(include_low_value=True)
        agent_api = self.create_agent_api(group_service, max_tokens=30)

        result = agent_api.restore("kingbase-group", token_count=30)
        compiled = ContextCompiler(OpenAICompatibleAdapter(ProviderCapability(max_context_tokens=30))).compile(
            CompileRequest(
                context_items=list(group_service.items.values()),
                groups=list(group_service.groups.values()),
                selected_item_ids=["kingbase-item"],
            )
        )

        self.assertEqual(result.status, "restored")
        self.assertTrue(result.continue_run)
        self.assertEqual(result.final_tokens, 30)
        self.assertEqual(group_service.groups["low-value-group"].state, ContextItemState.EVICTED)
        self.assertEqual(group_service.groups["kingbase-group"].state, ContextItemState.RAW)
        self.assertTrue(compiled.allowed)
        self.assertLessEqual(compiled.diagnostics["token_budget"]["current_tokens"], 30)
        self.assertEqual(revisions.list_revisions("low-value-item")[0].revision_type.value, "SYSTEM_EVICT")
        self.assertEqual(revisions.list_revisions("kingbase-item")[0].revision_type.value, "AGENT_RESTORE")
        self.assertEqual(
            result.trace_events,
            [
                "agent_restore_requested:kingbase-group",
                "restore_planned",
                "evicted:low-value-group",
                "restored:kingbase-group",
                "agent_restore_restored:kingbase-group",
            ],
        )


if __name__ == "__main__":
    unittest.main()
