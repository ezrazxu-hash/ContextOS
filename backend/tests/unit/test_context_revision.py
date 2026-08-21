from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ContextRevisionTests(unittest.TestCase):
    def test_revision_type_covers_prd_values(self) -> None:
        from contextos.context.revision.model import RevisionType

        self.assertEqual(
            {revision_type.value for revision_type in RevisionType},
            {
                "USER_EDIT",
                "SYSTEM_ABSTRACT",
                "SYSTEM_EVICT",
                "USER_RESTORE",
                "AGENT_RESTORE",
                "USER_PIN",
                "USER_UNPIN",
            },
        )

    def test_consecutive_edits_preserve_complete_revision_chain(self) -> None:
        from contextos.context.revision.model import RevisionType
        from contextos.context.revision.repository import InMemoryContextRevisionRepository
        from contextos.context.revision.service import ContextRevisionService

        service = ContextRevisionService(InMemoryContextRevisionRepository())
        first = service.record_revision(
            context_item_id="item-1",
            revision_type=RevisionType.USER_EDIT,
            old_value="raw",
            new_value="override-1",
            operator="user",
            reason="correct answer",
        )
        second = service.record_revision(
            context_item_id="item-1",
            revision_type=RevisionType.USER_EDIT,
            old_value=first.new_value,
            new_value="override-2",
            operator="user",
            reason="refine answer",
        )

        revisions = service.list_revisions("item-1")

        self.assertEqual([revision.id for revision in revisions], [first.id, second.id])
        self.assertEqual([(revision.old_value, revision.new_value) for revision in revisions], [("raw", "override-1"), ("override-1", "override-2")])

    def test_restore_appends_revision_without_deleting_history(self) -> None:
        from contextos.context.revision.model import RevisionType
        from contextos.context.revision.repository import InMemoryContextRevisionRepository
        from contextos.context.revision.service import ContextRevisionService

        service = ContextRevisionService(InMemoryContextRevisionRepository())
        service.record_revision("item-1", RevisionType.USER_EDIT, "raw", "override-1", "user", "edit")
        service.record_revision("item-1", RevisionType.SYSTEM_ABSTRACT, "override-1", "summary", "system", "abstract")
        restore = service.record_revision("item-1", RevisionType.USER_RESTORE, "summary", "raw", "user", "restore system version")

        revisions = service.list_revisions("item-1")

        self.assertEqual(len(revisions), 3)
        self.assertEqual(revisions[-1].id, restore.id)
        self.assertEqual([revision.revision_type for revision in revisions], [RevisionType.USER_EDIT, RevisionType.SYSTEM_ABSTRACT, RevisionType.USER_RESTORE])


if __name__ == "__main__":
    unittest.main()
