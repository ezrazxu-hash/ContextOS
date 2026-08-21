import unittest


class MessageEditApiTests(unittest.TestCase):
    def create_message_services(self):
        from contextos.runtime.session.message_revision_service import MessageRevisionService
        from contextos.runtime.session.message_service import MessageService

        message_service = MessageService()
        revision_service = MessageRevisionService()
        message = message_service.create_message(
            session_id="session-1",
            role="assistant",
            content="original answer",
            token_count=2,
            tool_call_ids=["call-1"],
            tool_result_ids=["call-1"],
        )
        return message, message_service, revision_service

    def test_patch_returns_revision_id_and_does_not_call_historical_tool(self) -> None:
        from contextos.api.routes.messages import patch_message

        message, message_service, revision_service = self.create_message_services()
        replay_calls: list[str] = []

        response = patch_message(
            message.id,
            {"new_content": "edited answer", "operator": "user", "reason": "fix"},
            message_service,
            revision_service,
            tool_runner=lambda call_id: replay_calls.append(call_id),
        )

        self.assertEqual(response["status"], 200)
        self.assertIn("revision_id", response["body"])
        self.assertEqual(response["body"]["impact"]["triggered"], True)
        self.assertEqual(response["body"]["impact"]["requires_replay"], False)
        self.assertEqual(replay_calls, [])

    def test_saved_edit_keeps_original_readable(self) -> None:
        from contextos.api.routes.messages import get_message_original, patch_message

        message, message_service, revision_service = self.create_message_services()

        patch_message(
            message.id,
            {"new_content": "edited answer", "operator": "user", "reason": "fix"},
            message_service,
            revision_service,
        )
        original = get_message_original(message.id, revision_service)

        self.assertEqual(message.content, "original answer")
        self.assertEqual(original["status"], 200)
        self.assertEqual(original["body"]["original_content"], "original answer")
        self.assertEqual(revision_service.current_content(message.id), "edited answer")


if __name__ == "__main__":
    unittest.main()
