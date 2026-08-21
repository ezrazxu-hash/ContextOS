from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class MvpEditAbstractE2ETests(unittest.TestCase):
    def create_service(self):
        from contextos.context.group.model import ContextGroup, ContextGroupType
        from contextos.context.group.service import ContextGroupService
        from contextos.context.model.enums import ContextItemState, ContextItemType
        from contextos.context.model.item import ContextItem
        from contextos.context.revision.repository import InMemoryContextRevisionRepository
        from contextos.context.revision.service import ContextRevisionService

        item = ContextItem(
            id="abstract-item",
            session_id="session-1",
            timeline_id="timeline-1",
            group_id="abstract-group",
            type=ContextItemType.SUMMARY,
            state=ContextItemState.ABSTRACT,
            raw_content="raw architecture discussion",
            generated_content="用户最终选择 PostgreSQL。",
            user_override=None,
            source_ids=["message-1"],
            token_count_raw=20,
            token_count_effective=3,
            priority=0,
            restorable=True,
        )
        group = ContextGroup(
            id="abstract-group",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.MESSAGE_GROUP,
            item_ids=["abstract-item"],
            atomic=True,
            state=ContextItemState.ABSTRACT,
            summary="用户最终选择 PostgreSQL。",
            placeholder=None,
            source_token_count=20,
            effective_token_count=3,
            restorable=True,
            dependencies=[],
        )
        return ContextGroupService(
            {"abstract-item": item},
            {"abstract-group": group},
            ContextRevisionService(InMemoryContextRevisionRepository()),
        )

    def test_edit_abstract_preserves_system_version_and_restore_uses_generated_content(self) -> None:
        from contextos.api.routes.context import get_session_context, patch_context_item, post_context_item_restore_system

        service = self.create_service()

        edited = patch_context_item(
            "abstract-item",
            {"user_override": "用户最终选择 MySQL。", "operator": "user", "reason": "manual abstract correction"},
            service,
        )
        debug_after_edit = get_session_context("session-1", service)
        restored = post_context_item_restore_system("abstract-item", service)
        debug_after_restore = get_session_context("session-1", service)

        self.assertEqual(edited["body"]["effective_content"], "用户最终选择 MySQL。")
        self.assertEqual(edited["body"]["generated_content"], "用户最终选择 PostgreSQL。")
        self.assertEqual(debug_after_edit["body"][0]["effective_content"], "用户最终选择 MySQL。")
        self.assertEqual(debug_after_edit["body"][0]["generated_content"], "用户最终选择 PostgreSQL。")
        self.assertEqual(debug_after_edit["body"][0]["user_override"], "用户最终选择 MySQL。")
        self.assertEqual(restored["status"], 200)
        self.assertEqual(restored["body"]["generated_content"], "用户最终选择 PostgreSQL。")
        self.assertEqual(restored["body"]["user_override"], None)
        self.assertEqual(restored["body"]["effective_content"], "用户最终选择 PostgreSQL。")
        self.assertEqual(debug_after_restore["body"][0]["effective_content"], "用户最终选择 PostgreSQL。")


if __name__ == "__main__":
    unittest.main()
