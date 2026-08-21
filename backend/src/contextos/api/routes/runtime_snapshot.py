from contextos.api.errors import ApiError
from contextos.runtime.session.snapshot_service import RuntimeSnapshotService, SnapshotSessionNotFound


def get_runtime_snapshot(session_id: str, service: RuntimeSnapshotService, request_id: str = "req-runtime-snapshot") -> dict[str, object]:
    try:
        snapshot = service.rehydrate(session_id)
    except SnapshotSessionNotFound:
        return {
            "status": 404,
            "body": ApiError("session.not_found", "Session not found", request_id, 404).to_rest_payload(),
        }
    return {
        "status": 200,
        "body": snapshot,
    }

