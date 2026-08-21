from contextos.runtime.checkpoint.model import Checkpoint
from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
from contextos.runtime.session.message import MessageRole, SessionMessage
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.session.repository import InMemorySessionRepository
from contextos.runtime.timeline.model import Timeline
from contextos.runtime.timeline.repository import InMemoryTimelineRepository
from contextos.runtime.trace.model import TraceEvent
from contextos.runtime.trace.repository import InMemoryTraceRepository


class DebugSessionNotFound(Exception):
    pass


class DebugProjection:
    def __init__(
        self,
        session_repository: InMemorySessionRepository,
        timeline_repository: InMemoryTimelineRepository,
        checkpoint_store: InMemoryCheckpointStore,
        message_service: MessageService,
        trace_repository: InMemoryTraceRepository,
    ) -> None:
        self._session_repository = session_repository
        self._timeline_repository = timeline_repository
        self._checkpoint_store = checkpoint_store
        self._message_service = message_service
        self._trace_repository = trace_repository

    def index(
        self,
        session_id: str,
        *,
        trace_id: str | None = None,
        checkpoint_id: str | None = None,
        message_id: str | None = None,
        message_after_cursor: int | None = None,
        message_limit: int = 50,
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, object]:
        session = self._session_repository.get(session_id)
        if session is None:
            raise DebugSessionNotFound(session_id)

        timelines = self._timeline_repository.list_by_session(session_id)
        checkpoints = self._list_checkpoints(timelines)
        messages, next_message_cursor = self._list_messages(session_id, message_after_cursor, message_limit)
        traces = self._filter_traces(
            session_id,
            trace_id=trace_id,
            checkpoint_id=checkpoint_id,
            message_id=message_id,
        )
        latest_checkpoint = self._latest_checkpoint(checkpoints)

        return {
            "session": session.to_dict(),
            "graph": {"current_timeline_id": session.current_timeline_id},
            "timelines": [timeline.to_dict() for timeline in timelines],
            "checkpoints": [checkpoint_to_debug_dict(checkpoint) for checkpoint in checkpoints],
            "messages": [message.to_dict() for message in messages],
            "message_page": {
                "after_cursor": message_after_cursor,
                "limit": message_limit,
                "next_cursor": next_message_cursor,
            },
            "state": {"graph_state": dict(latest_checkpoint.graph_state)} if latest_checkpoint is not None else None,
            "traces": paginate_traces(traces, offset, limit),
            "tools": list_tool_pairs(messages),
            "context": {"revision": latest_checkpoint.context_revision} if latest_checkpoint is not None else None,
            "prompt_inputs": list_prompt_inputs(messages),
        }

    def _list_checkpoints(self, timelines: list[Timeline]) -> list[Checkpoint]:
        checkpoints: list[Checkpoint] = []
        for timeline in timelines:
            checkpoints.extend(self._checkpoint_store.list_by_timeline(timeline.id))
        return sorted(checkpoints, key=lambda checkpoint: checkpoint.created_at)

    def _list_messages(
        self,
        session_id: str,
        after_cursor: int | None,
        limit: int,
    ) -> tuple[list[SessionMessage], int | None]:
        return self._message_service.list_messages(session_id, after_cursor=after_cursor, limit=limit)

    def _filter_traces(
        self,
        session_id: str,
        *,
        trace_id: str | None,
        checkpoint_id: str | None,
        message_id: str | None,
    ) -> list[TraceEvent]:
        traces = self._trace_repository.list_by_session(session_id)
        if trace_id is not None:
            traces = [event for event in traces if event.trace_id == trace_id]
        if checkpoint_id is not None:
            traces = [event for event in traces if event.checkpoint_id == checkpoint_id]
        if message_id is not None:
            traces = [event for event in traces if event.message_id == message_id]
        return traces

    def _latest_checkpoint(self, checkpoints: list[Checkpoint]) -> Checkpoint | None:
        if not checkpoints:
            return None
        return max(checkpoints, key=lambda checkpoint: checkpoint.created_at)


def checkpoint_to_debug_dict(checkpoint: Checkpoint) -> dict[str, object]:
    return {
        "id": checkpoint.id,
        "session_id": checkpoint.session_id,
        "timeline_id": checkpoint.timeline_id,
        "graph_state": dict(checkpoint.graph_state),
        "message_cursor": checkpoint.message_cursor,
        "context_revision": checkpoint.context_revision,
        "created_at": checkpoint.created_at.isoformat(),
        "parent_checkpoint_id": checkpoint.parent_checkpoint_id,
    }


def paginate_traces(traces: list[TraceEvent], offset: int, limit: int) -> dict[str, object]:
    safe_offset = max(offset, 0)
    safe_limit = max(limit, 0)
    page = traces[safe_offset : safe_offset + safe_limit]
    return {
        "items": [event.to_dict() for event in page],
        "total": len(traces),
        "offset": safe_offset,
        "limit": safe_limit,
    }


def list_tool_pairs(messages: list[SessionMessage]) -> list[dict[str, str | None]]:
    pairs: list[dict[str, str | None]] = []
    for message in messages:
        for index, call_id in enumerate(message.tool_call_ids):
            result_id = message.tool_result_ids[index] if index < len(message.tool_result_ids) else None
            pairs.append({"call_id": call_id, "result_id": result_id})
    return pairs


def list_prompt_inputs(messages: list[SessionMessage]) -> list[dict[str, str]]:
    return [
        {"message_id": message.id, "content": message.content}
        for message in messages
        if message.role is MessageRole.USER
    ]
