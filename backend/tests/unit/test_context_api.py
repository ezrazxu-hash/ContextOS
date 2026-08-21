from pathlib import Path
import sys
import unittest

from backend.tests.unit.test_context_group_service import create_group, create_item


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ContextApiTests(unittest.TestCase):
    def create_service(self, items, groups):
        from contextos.context.group.service import ContextGroupService
        from contextos.context.revision.repository import InMemoryContextRevisionRepository
        from contextos.context.revision.service import ContextRevisionService

        revision_service = ContextRevisionService(InMemoryContextRevisionRepository())
        return ContextGroupService(items, groups, revision_service)

    def test_evict_atomic_group_succeeds_or_fails_as_a_whole(self) -> None:
        from contextos.api.routes.context import post_context_group_evict

        good_group = create_group("group-1", ["item-1", "item-2"], atomic=True)
        item_1 = create_item("item-1", "group-1", "raw one")
        item_2 = create_item("item-2", "group-1", "raw two")
        service = self.create_service({"item-1": item_1, "item-2": item_2}, {"group-1": good_group})

        success = post_context_group_evict("group-1", service)

        self.assertEqual(success["status"], 200)
        self.assertEqual(service.items["item-1"].state.value, "EVICTED")
        self.assertEqual(service.items["item-2"].state.value, "EVICTED")

        bad_group = create_group("group-2", ["item-3", "missing"], atomic=True)
        item_3 = create_item("item-3", "group-2", "raw three")
        failing_service = self.create_service({"item-3": item_3}, {"group-2": bad_group})

        failed = post_context_group_evict("group-2", failing_service)

        self.assertEqual(failed["status"], 400)
        self.assertEqual(failing_service.items["item-3"].state.value, "RAW")

    def test_raw_api_reads_persistent_raw_history_after_evict(self) -> None:
        from contextos.api.routes.context import get_context_item_raw, post_context_group_evict

        group = create_group("group-1", ["item-1"], atomic=True)
        item = create_item("item-1", "group-1", "persistent raw")
        service = self.create_service({"item-1": item}, {"group-1": group})
        post_context_group_evict("group-1", service)

        response = get_context_item_raw("item-1", service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"]["raw_content"], "persistent raw")

    def test_patch_item_makes_revision_visible(self) -> None:
        from contextos.api.routes.context import get_context_item_revisions, patch_context_item

        group = create_group("group-1", ["item-1"], atomic=True)
        item = create_item("item-1", "group-1", "raw")
        service = self.create_service({"item-1": item}, {"group-1": group})

        patch_context_item("item-1", {"user_override": "edited", "operator": "user", "reason": "fix"}, service)
        revisions = get_context_item_revisions("item-1", service)

        self.assertEqual(revisions["status"], 200)
        self.assertEqual(revisions["body"][0]["revision_type"], "USER_EDIT")
        self.assertEqual(revisions["body"][0]["new_value"], "edited")

    def test_session_context_projection_contains_ui_fields(self) -> None:
        from contextos.api.routes.context import get_session_context

        group = create_group("group-1", ["item-1"], atomic=True)
        item = create_item("item-1", "group-1", "raw")
        service = self.create_service({"item-1": item}, {"group-1": group})

        response = get_session_context("session-1", service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"][0]["id"], "item-1")
        self.assertEqual(response["body"][0]["state"], "RAW")
        self.assertEqual(response["body"][0]["group_id"], "group-1")
        self.assertEqual(response["body"][0]["token_count_effective"], 1)
        self.assertTrue(response["body"][0]["restorable"])


if __name__ == "__main__":
    unittest.main()
