import json


def format_sse(event_type: str, data: dict[str, object]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, sort_keys=True)}\n\n"
