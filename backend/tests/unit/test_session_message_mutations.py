from pathlib import Path
import sys
import tempfile
import unittest


BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT / "src"))


class SessionMessageMutationTests(unittest.TestCase):
    def test_edit_updates_effective_message_content_without_touching_other_sessions(self) -> None:
        from contextos.api.routes.messages import patch_message
        from contextos.runtime.persistence.json_store import JsonRuntimeStore
        from contextos.runtime.session.message_revision_service import MessageRevisionService
        from contextos.runtime.session.message_service import InMemoryMessageRepository, MessageService

        with tempfile.TemporaryDirectory() as temp_dir:
            store = JsonRuntimeStore(Path(temp_dir) / "runtime-state.json")
            service = MessageService(InMemoryMessageRepository(store))
            revision_service = MessageRevisionService()
            edited = service.create_message("session-1", "assistant", "original answer", message_id="message-edit")
            other = service.create_message("session-2", "assistant", "other session answer", message_id="message-other")

            response = patch_message(
                edited.id,
                {"new_content": "edited answer", "operator": "user", "reason": "fix"},
                service,
                revision_service,
            )

            self.assertEqual(response["status"], 200)
            self.assertEqual(service.get_message(edited.id).content, "edited answer")
            self.assertEqual(service.get_message(edited.id).revision_id, response["body"]["revision_id"])
            self.assertEqual(service.get_message(other.id).content, "other session answer")

            reloaded = MessageService(InMemoryMessageRepository(JsonRuntimeStore(store.path)))
            self.assertEqual(reloaded.get_message(edited.id).content, "edited answer")
            self.assertEqual(reloaded.get_message(other.id).content, "other session answer")

    def test_soft_delete_hides_message_from_default_session_query_but_keeps_original_data(self) -> None:
        from contextos.api.routes.messages import soft_delete_message
        from contextos.runtime.persistence.json_store import JsonRuntimeStore
        from contextos.runtime.session.message_service import InMemoryMessageRepository, MessageService

        with tempfile.TemporaryDirectory() as temp_dir:
            store = JsonRuntimeStore(Path(temp_dir) / "runtime-state.json")
            service = MessageService(InMemoryMessageRepository(store))
            deleted = service.create_message("session-1", "user", "remove from chat", message_id="message-delete")
            kept = service.create_message("session-1", "assistant", "keep visible", message_id="message-keep")

            response = soft_delete_message(deleted.id, service)

            visible, _next_cursor = service.list_messages("session-1")
            retained = service.get_message(deleted.id)
            self.assertEqual(response["status"], 200)
            self.assertEqual([message.id for message in visible], [kept.id])
            self.assertEqual(retained.content, "remove from chat")
            self.assertEqual(retained.is_deleted, True)
            self.assertIsNotNone(retained.deleted_at)

            reloaded = MessageService(InMemoryMessageRepository(JsonRuntimeStore(store.path)))
            self.assertEqual(reloaded.list_messages("session-1")[0][0].id, kept.id)
            self.assertEqual(reloaded.get_message(deleted.id).content, "remove from chat")
            self.assertEqual(reloaded.get_message(deleted.id).is_deleted, True)

    def test_delete_tool_group_marks_related_messages_together(self) -> None:
        from contextos.api.routes.messages import soft_delete_message
        from contextos.runtime.session.message_service import MessageService

        service = MessageService()
        service.create_message(
            "session-1",
            "assistant",
            "Calling lookup",
            message_id="message-tool-call",
            group_id="tool-group",
            tool_call_ids=["call-1"],
        )
        service.create_message(
            "session-1",
            "assistant",
            "Lookup result",
            message_id="message-tool-result",
            group_id="tool-group",
            tool_result_ids=["call-1"],
        )
        unrelated = service.create_message("session-1", "assistant", "Still visible", message_id="message-visible", group_id="other-group")

        response = soft_delete_message("message-tool-result", service)

        visible, _next_cursor = service.list_messages("session-1")
        self.assertEqual(response["status"], 200)
        self.assertEqual(sorted(response["body"]["message_ids"]), ["message-tool-call", "message-tool-result"])
        self.assertEqual([message.id for message in visible], [unrelated.id])
        self.assertEqual(service.get_message("message-tool-call").is_deleted, True)
        self.assertEqual(service.get_message("message-tool-result").is_deleted, True)

    def test_soft_delete_marks_conversation_group_deleted(self) -> None:
        from contextos.api.routes.messages import soft_delete_message
        from contextos.runtime.conversation.model import ConversationGroupState
        from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
        from contextos.runtime.conversation.service import ConversationGroupService
        from contextos.runtime.session.message_service import MessageService

        message_service = MessageService()
        group_repository = InMemoryConversationGroupRepository()
        group_service = ConversationGroupService(group_repository)
        group = group_service.start_turn("session-1", "timeline-1", "message-user", group_id="group-1")
        message_service.create_message("session-1", "user", "delete turn", timeline_id="timeline-1", group_id=group.id, message_id="message-user")
        message_service.create_message("session-1", "assistant", "delete response", timeline_id="timeline-1", group_id=group.id, message_id="message-assistant")
        group_service.append_message(group.id, "message-assistant")

        response = soft_delete_message("message-user", message_service, group_service)

        self.assertEqual(response["status"], 200)
        self.assertEqual(sorted(response["body"]["message_ids"]), ["message-assistant", "message-user"])
        self.assertEqual(group_repository.get(group.id).state, ConversationGroupState.DELETED)


if __name__ == "__main__":
    unittest.main()
