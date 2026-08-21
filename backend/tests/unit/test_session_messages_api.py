import unittest


class SessionMessagesApiTests(unittest.TestCase):
    def test_user_message_can_be_saved_and_read(self) -> None:
        from contextos.api.routes.sessions import get_session_messages, post_session_message
        from contextos.runtime.session.message_service import MessageService

        service = MessageService()
        created = post_session_message(
            "session-1",
            {"role": "user", "content": "Hello ContextOS", "token_count": 2},
            service,
        )
        listed = get_session_messages("session-1", service)

        self.assertEqual(created["status"], 201)
        self.assertEqual(created["body"]["session_id"], "session-1")
        self.assertEqual(created["body"]["role"], "user")
        self.assertEqual(created["body"]["cursor"], 1)
        self.assertEqual(listed["status"], 200)
        self.assertEqual(listed["body"]["messages"], [created["body"]])
        self.assertEqual(listed["body"]["next_cursor"], None)

    def test_assistant_message_preserves_metadata(self) -> None:
        from contextos.api.routes.sessions import post_session_message
        from contextos.runtime.session.message_service import MessageService

        response = post_session_message(
            "session-1",
            {
                "role": "assistant",
                "content": "The order shipped.",
                "status": "completed",
                "token_count": 4,
                "context_group_ids": ["group-1"],
                "checkpoint_id": "checkpoint-1",
                "trace_id": "trace-1",
                "tool_call_ids": ["call-1"],
                "tool_result_ids": ["call-1"],
            },
            MessageService(),
        )

        body = response["body"]
        self.assertEqual(response["status"], 201)
        self.assertEqual(body["role"], "assistant")
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["context_group_ids"], ["group-1"])
        self.assertEqual(body["checkpoint_id"], "checkpoint-1")
        self.assertEqual(body["trace_id"], "trace-1")
        self.assertEqual(body["tool_call_ids"], ["call-1"])
        self.assertEqual(body["tool_result_ids"], ["call-1"])

    def test_pagination_order_uses_server_cursor(self) -> None:
        from contextos.api.routes.sessions import get_session_messages, post_session_message
        from contextos.runtime.session.message_service import MessageService

        service = MessageService()
        post_session_message("session-1", {"role": "user", "content": "first", "cursor": 100}, service)
        post_session_message("session-1", {"role": "assistant", "content": "second", "cursor": 50}, service)
        post_session_message("session-1", {"role": "user", "content": "third", "cursor": 25}, service)

        first_page = get_session_messages("session-1", service, limit=2)
        second_page = get_session_messages("session-1", service, after_cursor=first_page["body"]["next_cursor"], limit=2)

        self.assertEqual([message["content"] for message in first_page["body"]["messages"]], ["first", "second"])
        self.assertEqual([message["cursor"] for message in first_page["body"]["messages"]], [1, 2])
        self.assertEqual(first_page["body"]["next_cursor"], 2)
        self.assertEqual([message["content"] for message in second_page["body"]["messages"]], ["third"])
        self.assertEqual(second_page["body"]["next_cursor"], None)


if __name__ == "__main__":
    unittest.main()
