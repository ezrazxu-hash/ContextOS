import unittest


def create_assistant_message():
    from contextos.runtime.session.message import MessageRole, MessageStatus, SessionMessage
    from contextos.runtime.session.model import utc_now

    return SessionMessage(
        id="message-1",
        session_id="session-1",
        cursor=1,
        role=MessageRole.ASSISTANT,
        content="original answer",
        status=MessageStatus.COMPLETED,
        token_count=2,
        created_at=utc_now(),
    )


class MessageRevisionServiceTests(unittest.TestCase):
    def test_first_edit_preserves_original_message(self) -> None:
        from contextos.runtime.session.message_revision_service import MessageRevisionService

        message = create_assistant_message()
        service = MessageRevisionService()

        revision = service.append_revision(
            message,
            new_content="edited answer",
            operator="user",
            reason="fix wording",
            timeline_id="timeline-1",
            context_revision_id="context-revision-1",
        )

        self.assertEqual(message.content, "original answer")
        self.assertEqual(revision.original_content, "original answer")
        self.assertEqual(revision.previous_content, "original answer")
        self.assertEqual(revision.new_content, "edited answer")
        self.assertEqual(revision.revision_number, 1)
        self.assertEqual(revision.previous_revision_id, None)
        self.assertEqual(revision.timeline_id, "timeline-1")
        self.assertEqual(revision.context_revision_id, "context-revision-1")

    def test_second_edit_appends_without_overwriting_first_revision(self) -> None:
        from contextos.runtime.session.message_revision_service import MessageRevisionService

        message = create_assistant_message()
        service = MessageRevisionService()

        first = service.append_revision(message, "edited once", "user", "first")
        second = service.append_revision(message, "edited twice", "user", "second")
        revisions = service.list_revisions(message.id)

        self.assertEqual([revision.id for revision in revisions], [first.id, second.id])
        self.assertEqual(first.new_content, "edited once")
        self.assertEqual(second.previous_content, "edited once")
        self.assertEqual(second.new_content, "edited twice")
        self.assertEqual(second.previous_revision_id, first.id)
        self.assertEqual(service.current_content(message.id), "edited twice")
        self.assertEqual(message.content, "original answer")


if __name__ == "__main__":
    unittest.main()
