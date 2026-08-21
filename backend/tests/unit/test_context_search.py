import unittest


def make_group(
    group_id: str,
    summary: str,
    state,
    group_type,
    timeline_id: str = "timeline-1",
    tokens: int = 100,
    restorable: bool = True,
):
    from contextos.context.group.model import ContextGroup

    return ContextGroup(
        id=group_id,
        session_id="session-1",
        timeline_id=timeline_id,
        group_type=group_type,
        item_ids=[f"{group_id}-item"],
        atomic=False,
        state=state,
        summary=summary,
        placeholder=None,
        source_token_count=tokens,
        effective_token_count=tokens,
        restorable=restorable,
        dependencies=[],
    )


class ContextSearchTests(unittest.TestCase):
    def test_keyword_finds_evicted_kingbase_sql_group(self) -> None:
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.search import ContextSearchQuery, search_context_groups

        groups = [
            make_group(
                "group-kingbase",
                "Kingbase SQL optimizer trace and slow query notes",
                ContextItemState.EVICTED,
                ContextGroupType.TOOL_INTERACTION,
                tokens=26400,
            ),
            make_group(
                "group-other",
                "Redis cache notes",
                ContextItemState.EVICTED,
                ContextGroupType.TOOL_INTERACTION,
            ),
        ]

        results = search_context_groups(groups, ContextSearchQuery(keyword="kingbase sql"))

        self.assertEqual(len(results), 1)
        self.assertEqual(
            results[0].to_dict(),
            {
                "group_id": "group-kingbase",
                "summary": "Kingbase SQL optimizer trace and slow query notes",
                "state": "EVICTED",
                "token_count": 26400,
                "restorable": True,
            },
        )

    def test_state_evicted_filter_only_returns_evicted_groups(self) -> None:
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.search import ContextSearchQuery, search_context_groups

        groups = [
            make_group("group-raw", "Kingbase SQL current notes", ContextItemState.RAW, ContextGroupType.MESSAGE_GROUP),
            make_group("group-evicted", "Kingbase SQL older notes", ContextItemState.EVICTED, ContextGroupType.MESSAGE_GROUP),
        ]

        results = search_context_groups(groups, ContextSearchQuery(state=ContextItemState.EVICTED))

        self.assertEqual([result.group_id for result in results], ["group-evicted"])

    def test_type_and_timeline_filters_are_applied_without_semantic_search(self) -> None:
        from contextos.context.group.model import ContextGroupType
        from contextos.context.model.enums import ContextItemState
        from contextos.context.restore.search import ContextSearchQuery, search_context_groups

        groups = [
            make_group(
                "group-tool",
                "Kingbase SQL tool result",
                ContextItemState.EVICTED,
                ContextGroupType.TOOL_INTERACTION,
                timeline_id="timeline-1",
            ),
            make_group(
                "group-message",
                "Kingbase SQL message",
                ContextItemState.EVICTED,
                ContextGroupType.MESSAGE_GROUP,
                timeline_id="timeline-1",
            ),
            make_group(
                "group-other-timeline",
                "Kingbase SQL other timeline",
                ContextItemState.EVICTED,
                ContextGroupType.TOOL_INTERACTION,
                timeline_id="timeline-2",
            ),
        ]

        results = search_context_groups(
            groups,
            ContextSearchQuery(
                keyword="Kingbase",
                group_type=ContextGroupType.TOOL_INTERACTION,
                timeline_id="timeline-1",
            ),
        )

        self.assertEqual([result.group_id for result in results], ["group-tool"])


if __name__ == "__main__":
    unittest.main()
