import unittest


def make_item(item_id, group_id, state, raw_content):
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
        token_count_raw=len(raw_content.split()),
        token_count_effective=len(raw_content.split()),
        priority=0,
        restorable=True,
    )


def make_group(group_id, item_ids, state, summary=None, atomic=False):
    from contextos.context.group.model import ContextGroup, ContextGroupType

    return ContextGroup(
        id=group_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_type=ContextGroupType.MESSAGE_GROUP,
        item_ids=item_ids,
        atomic=atomic,
        state=state,
        summary=summary,
        placeholder=None,
        source_token_count=100,
        effective_token_count=100,
        restorable=True,
        dependencies=[],
    )


def create_group_service(items, groups):
    from contextos.context.group.service import ContextGroupService
    from contextos.context.revision.repository import InMemoryContextRevisionRepository
    from contextos.context.revision.service import ContextRevisionService

    revision_service = ContextRevisionService(InMemoryContextRevisionRepository())
    return ContextGroupService(items, groups, revision_service), revision_service


class ContextOperatorNodeTests(unittest.TestCase):
    def test_search_abstract_writer_flow_is_runnable(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.template.compiler.context_operator import ContextOperatorNode

        item = make_item("item-1", "group-1", ContextItemState.RAW, "Kingbase SQL raw notes")
        group = make_group("group-1", ["item-1"], ContextItemState.RAW, summary="Kingbase SQL summary")
        group_service, _ = create_group_service({"item-1": item}, {"group-1": group})
        node = ContextOperatorNode(group_service=group_service, groups=[group])

        state = node.run({"operator": "SEARCH", "keyword": "Kingbase"})
        state = node.run(
            {
                **state,
                "operator": "ABSTRACT",
                "group_id": "group-1",
                "generated_content_by_item_id": {"item-1": "Kingbase SQL compact summary"},
            }
        )
        state = {**state, "writer_output": group_service.items["item-1"].effective_content}

        self.assertEqual(state["search_results"][0]["group_id"], "group-1")
        self.assertEqual(state["writer_output"], "Kingbase SQL compact summary")
        self.assertEqual(group_service.groups["group-1"].state, ContextItemState.ABSTRACT)
        self.assertEqual(state["trace_events"], ["context.search:Kingbase", "context.abstract:group-1"])

    def test_evict_atomic_group_keeps_members_together(self) -> None:
        from contextos.context.model.enums import ContextItemState
        from contextos.template.compiler.context_operator import ContextOperatorNode

        items = {
            "call": make_item("call", "tool-group", ContextItemState.RAW, "tool call"),
            "result": make_item("result", "tool-group", ContextItemState.RAW, "tool result"),
        }
        group = make_group("tool-group", ["call", "result"], ContextItemState.RAW, atomic=True)
        group_service, _ = create_group_service(items, {"tool-group": group})
        node = ContextOperatorNode(group_service=group_service, groups=[group])

        state = node.run({"operator": "EVICT", "group_id": "tool-group"})

        self.assertEqual(group_service.groups["tool-group"].state, ContextItemState.EVICTED)
        self.assertEqual(group_service.items["call"].state, ContextItemState.EVICTED)
        self.assertEqual(group_service.items["result"].state, ContextItemState.EVICTED)
        self.assertEqual(state["trace_events"], ["context.evict:tool-group"])


if __name__ == "__main__":
    unittest.main()
