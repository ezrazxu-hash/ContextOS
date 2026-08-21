from typing import Callable

from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.timeline.edit_fork_service import EditForkService
from contextos.runtime.timeline.service import TimelineService


def post_message_context_only(
    message_id: str,
    payload: dict[str, object],
    timeline_service: TimelineService,
    message_service: MessageService,
    revision_service: MessageRevisionService,
    agent_runner: Callable[[], object] | None = None,
) -> dict[str, object]:
    del agent_runner
    result = EditForkService(timeline_service, message_service, revision_service).apply_context_only_edit(
        parent_timeline_id=str(payload["parent_timeline_id"]),
        message_id=message_id,
        revision_id=str(payload["revision_id"]),
    )
    return {
        "status": 200,
        "body": {
            "timeline": result.timeline.to_dict(),
            "working_context_messages": result.working_context_messages,
        },
    }
