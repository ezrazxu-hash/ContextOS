from uuid import uuid4

from contextos.runtime.trace.model import TraceEvent, utc_now
from contextos.runtime.trace.repository import InMemoryTraceRepository


SUMMARY_LIMIT = 120


class TraceCollector:
    def __init__(self, repository: InMemoryTraceRepository) -> None:
        self._repository = repository

    def record_model_call(
        self,
        trace_id: str,
        session_id: str,
        timeline_id: str,
        checkpoint_id: str,
        component: str,
        input_payload: object,
        output_payload: object,
        duration: float,
        message_id: str | None = None,
    ) -> TraceEvent:
        return self._record(
            trace_id=trace_id,
            session_id=session_id,
            timeline_id=timeline_id,
            checkpoint_id=checkpoint_id,
            step_type="model_call",
            component=component,
            input_payload=input_payload,
            output_payload=output_payload,
            duration=duration,
            status="success",
            message_id=message_id,
        )

    def record_tool_call(
        self,
        trace_id: str,
        session_id: str,
        timeline_id: str,
        checkpoint_id: str,
        component: str,
        input_payload: object,
        duration: float,
        message_id: str | None = None,
    ) -> TraceEvent:
        return self._record(
            trace_id,
            session_id,
            timeline_id,
            checkpoint_id,
            "tool_call",
            component,
            input_payload,
            None,
            duration,
            "success",
            message_id,
        )

    def record_tool_result(
        self,
        trace_id: str,
        session_id: str,
        timeline_id: str,
        checkpoint_id: str,
        component: str,
        output_payload: object,
        duration: float,
        message_id: str | None = None,
    ) -> TraceEvent:
        return self._record(
            trace_id,
            session_id,
            timeline_id,
            checkpoint_id,
            "tool_result",
            component,
            None,
            output_payload,
            duration,
            "success",
            message_id,
        )

    def record_failed(
        self,
        trace_id: str,
        session_id: str,
        timeline_id: str,
        checkpoint_id: str,
        step_type: str,
        component: str,
        input_payload: object,
        error: object,
        duration: float,
        message_id: str | None = None,
    ) -> TraceEvent:
        return self._record(
            trace_id,
            session_id,
            timeline_id,
            checkpoint_id,
            step_type,
            component,
            input_payload,
            error,
            duration,
            "failed",
            message_id,
        )

    def record_runtime_node(
        self,
        trace_id: str,
        session_id: str,
        timeline_id: str,
        checkpoint_id: str,
        run_id: str,
        agent_version_id: str,
        node_id: str,
        node_type: str,
        input_payload: object,
        output_payload: object,
        duration: float,
        status: str,
        route: str | None = None,
    ) -> TraceEvent:
        event = TraceEvent(
            id=f"trace_event_{uuid4().hex}",
            trace_id=trace_id,
            session_id=session_id,
            timeline_id=timeline_id,
            checkpoint_id=checkpoint_id,
            step_type="runtime_node",
            component=node_id,
            input_summary=summarize_payload(input_payload),
            output_summary=summarize_payload(output_payload),
            duration=duration,
            status=status,
            timestamp=utc_now(),
            run_id=run_id,
            agent_version_id=agent_version_id,
            node_id=node_id,
            node_type=node_type,
            route=route,
        )
        return self._repository.save(event)

    def list_by_session(self, session_id: str) -> list[TraceEvent]:
        return self._repository.list_by_session(session_id)

    def list_by_message(self, message_id: str) -> list[TraceEvent]:
        return self._repository.list_by_message(message_id)

    def list_by_trace(self, trace_id: str) -> list[TraceEvent]:
        return self._repository.list_by_trace(trace_id)

    def _record(
        self,
        trace_id: str,
        session_id: str,
        timeline_id: str,
        checkpoint_id: str,
        step_type: str,
        component: str,
        input_payload: object,
        output_payload: object,
        duration: float,
        status: str,
        message_id: str | None,
    ) -> TraceEvent:
        event = TraceEvent(
            id=f"trace_event_{uuid4().hex}",
            trace_id=trace_id,
            session_id=session_id,
            timeline_id=timeline_id,
            checkpoint_id=checkpoint_id,
            step_type=step_type,
            component=component,
            input_summary=summarize_payload(input_payload),
            output_summary=summarize_payload(output_payload),
            duration=duration,
            status=status,
            timestamp=utc_now(),
            message_id=message_id,
        )
        return self._repository.save(event)


def summarize_payload(payload: object) -> str:
    if payload is None:
        return ""
    text = str(payload)
    if len(text) <= SUMMARY_LIMIT:
        return text
    return f"{text[:SUMMARY_LIMIT]}... ({len(text)} chars)"

