from contextos.runtime.trace.collector import TraceCollector


def get_session_trace(session_id: str, collector: TraceCollector) -> dict[str, object]:
    return {
        "status": 200,
        "body": [event.to_dict() for event in collector.list_by_session(session_id)],
    }


def get_message_trace(message_id: str, collector: TraceCollector) -> dict[str, object]:
    return {
        "status": 200,
        "body": [event.to_dict() for event in collector.list_by_message(message_id)],
    }


def get_trace(trace_id: str, collector: TraceCollector) -> dict[str, object]:
    return {
        "status": 200,
        "body": [event.to_dict() for event in collector.list_by_trace(trace_id)],
    }

