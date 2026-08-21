from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class TraceEvent:
    id: str
    trace_id: str
    session_id: str
    timeline_id: str
    checkpoint_id: str
    step_type: str
    component: str
    input_summary: str
    output_summary: str
    duration: float
    status: str
    timestamp: datetime
    message_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "trace_id": self.trace_id,
            "session_id": self.session_id,
            "timeline_id": self.timeline_id,
            "checkpoint_id": self.checkpoint_id,
            "step_type": self.step_type,
            "component": self.component,
            "input_summary": self.input_summary,
            "output_summary": self.output_summary,
            "duration": self.duration,
            "status": self.status,
            "timestamp": self.timestamp.isoformat(),
            "message_id": self.message_id,
        }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)

