from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol

from contextos.runtime.agent.events import RuntimeEvent, legacy_event_to_runtime_event
from contextos.runtime.agent.protocol import AgentRunContext


class LegacyChatOrchestrator(Protocol):
    def stream_runtime_events(self, session_id: str, timeline_id: str, trace_id: str):
        ...


class LegacyChatRuntime:
    def __init__(self, orchestrator: LegacyChatOrchestrator) -> None:
        self._orchestrator = orchestrator

    def stream_runtime_events(self, run_context: AgentRunContext) -> Iterator[RuntimeEvent]:
        for event in self._orchestrator.stream_runtime_events(
            run_context.session_id,
            run_context.timeline_id,
            run_context.trace_id,
        ):
            yield legacy_event_to_runtime_event(event)
