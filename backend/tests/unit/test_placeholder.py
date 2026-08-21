from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class PlaceholderTests(unittest.TestCase):
    def create_group(self):
        from contextos.context.group.model import ContextGroup, ContextGroupType
        from contextos.context.model.enums import ContextItemState

        return ContextGroup(
            id="group-1",
            session_id="session-1",
            timeline_id="timeline-1",
            group_type=ContextGroupType.TOOL_INTERACTION,
            item_ids=["call-1", "result-1", "assistant-1"],
            atomic=True,
            state=ContextItemState.EVICTED,
            summary="Database schema checked.",
            placeholder=None,
            source_token_count=120,
            effective_token_count=8,
            restorable=True,
            dependencies=[],
        )

    def test_evict_placeholder_source_count_and_tokens_are_correct(self) -> None:
        from contextos.context.group.placeholder_service import PlaceholderService

        group = self.create_group()
        placeholder = PlaceholderService().create_for_group(group, reason="evicted from working context")

        self.assertEqual(placeholder.group_id, "group-1")
        self.assertEqual(placeholder.type, "TOOL_INTERACTION")
        self.assertEqual(placeholder.summary, "Database schema checked.")
        self.assertEqual(placeholder.source_count, 3)
        self.assertEqual(placeholder.original_tokens, 120)
        self.assertEqual(placeholder.current_tokens, 3)
        self.assertTrue(placeholder.restorable)
        self.assertEqual(placeholder.reason, "evicted from working context")

    def test_group_id_can_restore_original_group_reference(self) -> None:
        from contextos.context.group.placeholder_service import PlaceholderService

        group = self.create_group()
        service = PlaceholderService()
        placeholder = service.create_for_group(group, reason="evicted")

        self.assertEqual(service.get_source_group(placeholder.group_id), group)

    def test_placeholder_renders_for_compiler_as_structured_markup(self) -> None:
        from contextos.context.group.placeholder_service import PlaceholderService

        placeholder = PlaceholderService().create_for_group(self.create_group(), reason="evicted")

        rendered = placeholder.render_for_compiler()

        self.assertIn("<context-placeholder", rendered)
        self.assertIn('id="', rendered)
        self.assertIn('type="TOOL_INTERACTION"', rendered)
        self.assertIn('source-count="3"', rendered)
        self.assertIn("Database schema checked.", rendered)
        self.assertIn("</context-placeholder>", rendered)


if __name__ == "__main__":
    unittest.main()
