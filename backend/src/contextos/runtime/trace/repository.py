from contextos.runtime.trace.model import TraceEvent


class InMemoryTraceRepository:
    def __init__(self) -> None:
        self._events: list[TraceEvent] = []

    def save(self, event: TraceEvent) -> TraceEvent:
        self._events.append(event)
        return event

    def list_by_session(self, session_id: str) -> list[TraceEvent]:
        return [event for event in self._events if event.session_id == session_id]

    def list_by_message(self, message_id: str) -> list[TraceEvent]:
        return [event for event in self._events if event.message_id == message_id]

    def list_by_trace(self, trace_id: str) -> list[TraceEvent]:
        return [event for event in self._events if event.trace_id == trace_id]

