from collections.abc import Iterable, Iterator

from contextos.api.streaming.sse import format_sse
from contextos.provider.base.token_counter import count_text_tokens
from contextos.runtime.checkpoint.service import CheckpointService
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.trace.collector import TraceCollector


def stream_chat_events(
    *,
    session_id: str,
    timeline_id: str,
    trace_id: str,
    runtime_events: Iterable[dict[str, object]],
    message_service: MessageService,
    trace_collector: TraceCollector,
    checkpoint_service: CheckpointService,
) -> list[str]:
    return list(iter_chat_event_frames(
        session_id=session_id,
        timeline_id=timeline_id,
        trace_id=trace_id,
        runtime_events=runtime_events,
        message_service=message_service,
        trace_collector=trace_collector,
        checkpoint_service=checkpoint_service,
    ))


def iter_chat_event_frames(
    *,
    session_id: str,
    timeline_id: str,
    trace_id: str,
    runtime_events: Iterable[dict[str, object]],
    message_service: MessageService,
    trace_collector: TraceCollector,
    checkpoint_service: CheckpointService,
) -> Iterator[str]:
    token_parts: list[str] = []
    tool_call_ids: list[str] = []
    tool_result_ids: list[str] = []
    checkpoint_id: str | None = None

    for runtime_event in runtime_events:
        event_type = str(runtime_event["type"])
        data = dict(runtime_event.get("data", {}))

        if event_type == "token":
            token_parts.append(str(data.get("content", "")))
        elif event_type == "tool_call":
            call_id = str(data.get("call_id", ""))
            if call_id:
                tool_call_ids.append(call_id)
            trace_collector.record_tool_call(
                trace_id=trace_id,
                session_id=session_id,
                timeline_id=timeline_id,
                checkpoint_id=checkpoint_id or "",
                component=str(data.get("name", "tool")),
                input_payload=data,
                duration=0,
            )
        elif event_type == "tool_result":
            call_id = str(data.get("call_id", ""))
            if call_id:
                tool_result_ids.append(call_id)
            trace_collector.record_tool_result(
                trace_id=trace_id,
                session_id=session_id,
                timeline_id=timeline_id,
                checkpoint_id=checkpoint_id or "",
                component=str(data.get("call_id", "tool")),
                output_payload=data,
                duration=0,
            )
        elif event_type == "checkpoint":
            checkpoint = checkpoint_service.save_checkpoint(
                session_id=session_id,
                timeline_id=timeline_id,
                graph_state=dict(data.get("graph_state", {})),
                message_cursor=int(data.get("message_cursor", 0)),
                context_revision=str(data.get("context_revision", "")),
                parent_checkpoint_id=_optional_str(data.get("parent_checkpoint_id")),
            )
            checkpoint_id = checkpoint.id
            data["checkpoint_id"] = checkpoint.id
        elif event_type == "done":
            content = "".join(token_parts)
            message = message_service.create_message(
                session_id=session_id,
                role="assistant",
                content=content,
                status="completed",
                token_count=count_text_tokens(content),
                checkpoint_id=checkpoint_id,
                trace_id=trace_id,
                tool_call_ids=tool_call_ids,
                tool_result_ids=tool_result_ids,
            )
            trace_collector.record_model_call(
                trace_id=trace_id,
                session_id=session_id,
                timeline_id=timeline_id,
                checkpoint_id=checkpoint_id or "",
                component="chat",
                input_payload={},
                output_payload={"message_id": message.id, "content": content},
                duration=0,
                message_id=message.id,
            )
            data["message_id"] = message.id
            data["checkpoint_id"] = checkpoint_id

        yield format_sse(event_type, data)


def _optional_str(value: object) -> str | None:
    return str(value) if value is not None else None
