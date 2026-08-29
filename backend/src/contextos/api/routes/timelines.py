from contextos.api.errors import ApiError
from contextos.runtime.timeline.service import TimelineNotFound, TimelineService


def list_session_timelines(session_id: str, service: TimelineService, request_id: str = "req-timeline-list") -> dict[str, object]:
    timelines = service.list_timelines(session_id)
    return {
        "status": 200,
        "body": [timeline.to_dict() for timeline in timelines],
    }


def get_timeline(timeline_id: str, service: TimelineService, request_id: str = "req-timeline-get") -> dict[str, object]:
    try:
        timeline = service.get_timeline(timeline_id)
    except TimelineNotFound:
        return {
            "status": 404,
            "body": ApiError("timeline.not_found", "Timeline not found", request_id, 404).to_rest_payload(),
        }
    return {
        "status": 200,
        "body": timeline.to_dict(),
    }


def activate_timeline(timeline_id: str, service: TimelineService, request_id: str = "req-timeline-activate") -> dict[str, object]:
    try:
        timeline = service.activate_timeline(timeline_id)
    except TimelineNotFound:
        return {
            "status": 404,
            "body": ApiError("timeline.not_found", "Timeline not found", request_id, 404).to_rest_payload(),
        }
    return {
        "status": 200,
        "body": timeline.to_dict(),
    }


def remove_timeline(timeline_id: str, service: TimelineService, request_id: str = "req-timeline-delete") -> dict[str, object]:
    try:
        result = service.delete_timeline(timeline_id)
    except TimelineNotFound:
        return {
            "status": 404,
            "body": ApiError("timeline.not_found", "Timeline not found", request_id, 404).to_rest_payload(),
        }
    return {
        "status": 200,
        "body": {
            "timeline": result.timeline.to_dict(),
            "current_timeline_id": result.current_timeline_id,
        },
    }

