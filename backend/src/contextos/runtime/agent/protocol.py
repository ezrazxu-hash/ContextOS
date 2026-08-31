from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from contextos.runtime.agent.events import RuntimeEvent


@dataclass(frozen=True)
class AgentRunContext:
    session_id: str
    timeline_id: str
    trace_id: str
    agent_version_id: str | None = None
    input: str = ""
    message_history: list[dict[str, str]] = field(default_factory=list)

    def __post_init__(self) -> None:
        _require_non_empty(self.session_id, "session_id")
        _require_non_empty(self.timeline_id, "timeline_id")
        _require_non_empty(self.trace_id, "trace_id")


@runtime_checkable
class AgentRuntime(Protocol):
    def stream_runtime_events(self, run_context: AgentRunContext) -> Iterator[RuntimeEvent]:
        ...


def _require_non_empty(value: str, field_name: str) -> None:
    if not value:
        raise ValueError(f"{field_name} is required")
