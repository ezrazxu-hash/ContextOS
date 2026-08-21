from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


def create_item(item_id: str, group_id: str, raw_content: str):
    from contextos.context.model.enums import ContextItemState, ContextItemType
    from contextos.context.model.item import ContextItem

    return ContextItem(
        id=item_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_id=group_id,
        type=ContextItemType.MESSAGE,
        state=ContextItemState.RAW,
        raw_content=raw_content,
        generated_content=None,
        user_override=None,
        source_ids=[],
        token_count_raw=len(raw_content.split()),
        token_count_effective=len(raw_content.split()),
        priority=0,
        restorable=True,
    )


def create_group(group_id: str, item_ids: list[str], atomic: bool = True):
    from contextos.context.group.model import ContextGroup, ContextGroupType
    from contextos.context.model.enums import ContextItemState

    return ContextGroup(
        id=group_id,
        session_id="session-1",
        timeline_id="timeline-1",
        group_type=ContextGroupType.MESSAGE_GROUP,
        item_ids=item_ids,
        atomic=atomic,
        state=ContextItemState.RAW,
        summary=None,
        placeholder=None,
        source_token_count=10,
        effective_token_count=10,
        restorable=True,
        dependencies=[],
    )


class ContextGroupServiceTests(unittest.TestCase):
    def create_service(self, items, groups):
        from contextos.context.group.service import ContextGroupService
        from contextos.context.revision.repository import InMemoryContextRevisionRepository
        from contextos.context.revision.service import ContextRevisionService

        revision_service = ContextRevisionService(InMemoryContextRevisionRepository())
        return ContextGroupService(items, groups, revision_service), revision_service

    def test_evict_preserves_raw_for_view_raw_and_records_revision(self) -> None:
        group = create_group("group-1", ["item-1"])
        item = create_item("item-1", "group-1", "original raw")
        service, revisions = self.create_service({"item-1": item}, {"group-1": group})

        service.evict_group("group-1", operator="system", reason="budget")

        self.assertEqual(service.view_raw("item-1"), "original raw")
        self.assertEqual(service.items["item-1"].state.value, "EVICTED")
        self.assertEqual(revisions.list_revisions("item-1")[0].revision_type.value, "SYSTEM_EVICT")

    def test_abstract_writes_generated_content_and_effective_content_uses_it(self) -> None:
        group = create_group("group-1", ["item-1"])
        item = create_item("item-1", "group-1", "long raw content")
        service, revisions = self.create_service({"item-1": item}, {"group-1": group})

        service.abstract_group("group-1", {"item-1": "short summary"}, operator="system", reason="summarize")

        updated = service.items["item-1"]
        self.assertEqual(updated.state.value, "ABSTRACT")
        self.assertEqual(updated.generated_content, "short summary")
        self.assertEqual(updated.effective_content, "short summary")
        self.assertEqual(revisions.list_revisions("item-1")[0].revision_type.value, "SYSTEM_ABSTRACT")

    def test_atomic_operation_failure_rolls_back_all_group_members(self) -> None:
        from contextos.context.group.service import ContextGroupOperationError

        group = create_group("group-1", ["item-1", "item-2"], atomic=True)
        item_1 = create_item("item-1", "group-1", "raw one")
        item_2 = create_item("item-2", "group-1", "raw two")
        service, revisions = self.create_service({"item-1": item_1, "item-2": item_2}, {"group-1": group})

        with self.assertRaises(ContextGroupOperationError):
            service.abstract_group("group-1", {"item-1": "summary one"}, operator="system", reason="incomplete")

        self.assertEqual(service.items["item-1"].state.value, "RAW")
        self.assertEqual(service.items["item-2"].state.value, "RAW")
        self.assertEqual(service.items["item-1"].generated_content, None)
        self.assertEqual(revisions.list_revisions("item-1"), [])
        self.assertEqual(revisions.list_revisions("item-2"), [])


if __name__ == "__main__":
    unittest.main()
