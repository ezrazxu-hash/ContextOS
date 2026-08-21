from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ApiError:
    code: str
    message: str
    request_id: str
    status: int

    def to_rest_payload(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "request_id": self.request_id,
                "status": self.status,
            }
        }

    def to_sse_event(self) -> dict[str, Any]:
        return {
            "event": "error",
            "data": self.to_rest_payload(),
        }


def parse_error_payload(payload: dict[str, Any]) -> ApiError:
    error = payload["error"]
    return ApiError(
        code=error["code"],
        message=error["message"],
        request_id=error["request_id"],
        status=error["status"],
    )

