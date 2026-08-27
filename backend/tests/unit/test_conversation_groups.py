from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ConversationGroupTests(unittest.TestCase):
    def test_turn_group_preserves_message_order_and_timeline_scope(self) -> None:
        from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
        from contextos.runtime.conversation.service import ConversationGroupService

        repository = InMemoryConversationGroupRepository()
        service = ConversationGroupService(repository)

        first = service.start_turn("session-1", "timeline-a", "user-1")
        service.append_message(first.id, "assistant-1")
        second = service.start_turn("session-1", "timeline-a", "user-2")
        service.append_message(second.id, "assistant-2")
        service.start_turn("session-1", "timeline-b", "user-b")

        groups = service.list_groups("session-1", "timeline-a")

        self.assertEqual([group.id for group in groups], [first.id, second.id])
        self.assertEqual([group.message_ids for group in groups], [["user-1", "assistant-1"], ["user-2", "assistant-2"]])
        self.assertEqual([group.cursor for group in groups], [1, 2])
        self.assertTrue(all(group.state.value == "ACTIVE" for group in groups))


if __name__ == "__main__":
    unittest.main()
