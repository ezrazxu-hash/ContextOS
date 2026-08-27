from pathlib import Path
import sys
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class ConversationContextBuilderTests(unittest.TestCase):
    def test_builds_llm_messages_from_active_groups_in_stable_order(self) -> None:
        from contextos.runtime.conversation.context_builder import ConversationContextBuilder
        from contextos.runtime.conversation.model import ConversationGroupState
        from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
        from contextos.runtime.conversation.service import ConversationGroupService
        from contextos.runtime.session.message_service import MessageService

        message_service = MessageService()
        group_repository = InMemoryConversationGroupRepository()
        group_service = ConversationGroupService(group_repository)

        group1 = group_service.start_turn("session-1", "timeline-1", "message-user-1")
        message_service.create_message("session-1", "user", "My name is Tom", timeline_id="timeline-1", group_id=group1.id, message_id="message-user-1")
        message_service.create_message("session-1", "assistant", "Nice to meet you, Tom.", timeline_id="timeline-1", group_id=group1.id, message_id="message-assistant-1")
        group_service.append_message(group1.id, "message-assistant-1")

        group2 = group_service.start_turn("session-1", "timeline-1", "message-user-2")
        message_service.create_message("session-1", "user", "What is my name?", timeline_id="timeline-1", group_id=group2.id, message_id="message-user-2")
        message_service.create_message("session-1", "assistant", "Your name is Tom.", timeline_id="timeline-1", group_id=group2.id, message_id="message-assistant-2")
        group_service.append_message(group2.id, "message-assistant-2")

        excluded = group_service.start_turn("session-1", "timeline-1", "message-excluded")
        group_service.set_state(excluded.id, ConversationGroupState.EXCLUDED)
        message_service.create_message("session-1", "user", "Do not include me", timeline_id="timeline-1", group_id=excluded.id, message_id="message-excluded")

        builder = ConversationContextBuilder(group_repository, message_service)

        self.assertEqual(
            builder.build_llm_messages("session-1", "timeline-1"),
            [
                {"role": "user", "content": "My name is Tom"},
                {"role": "assistant", "content": "Nice to meet you, Tom."},
                {"role": "user", "content": "What is my name?"},
                {"role": "assistant", "content": "Your name is Tom."},
            ],
        )


if __name__ == "__main__":
    unittest.main()
