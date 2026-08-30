from __future__ import annotations

from dataclasses import dataclass, replace
from uuid import uuid4

from contextos.runtime.agent.events import RuntimeEvent
from contextos.runtime.agent.protocol import AgentRunContext, AgentRuntime


@dataclass(frozen=True)
class AgentTestRun:
    id: str
    agent_version_id: str
    input: str
    status: str
    trace_id: str
    events: list[RuntimeEvent]


class AgentTestRunNotFound(Exception):
    pass


class InMemoryAgentTestRunStore:
    def __init__(self) -> None:
        self._runs: dict[str, AgentTestRun] = {}

    def save(self, run: AgentTestRun) -> AgentTestRun:
        self._runs[run.id] = replace(run, events=list(run.events))
        return self.get(run.id)

    def get(self, run_id: str) -> AgentTestRun:
        run = self._runs.get(run_id)
        if run is None:
            raise AgentTestRunNotFound(run_id)
        return replace(run, events=list(run.events))


class AgentTestRunService:
    def __init__(
        self,
        runtime: AgentRuntime,
        store: InMemoryAgentTestRunStore,
        *,
        message_service: object | None = None,
    ) -> None:
        self._runtime = runtime
        self._store = store
        self._message_service = message_service

    def start(self, *, agent_version_id: str, input: str) -> AgentTestRun:
        _ = self._message_service
        run_id = f"test_run_{uuid4().hex}"
        trace_id = f"trace_{run_id}"
        run = self._store.save(
            AgentTestRun(
                id=run_id,
                agent_version_id=agent_version_id,
                input=input,
                status="running",
                trace_id=trace_id,
                events=[],
            )
        )

        events: list[RuntimeEvent] = []
        status = "completed"
        try:
            context = AgentRunContext(
                session_id=f"ephemeral_session_{run_id}",
                timeline_id=f"ephemeral_timeline_{run_id}",
                trace_id=trace_id,
                agent_version_id=agent_version_id,
                input=input,
            )
            for event in self._runtime.stream_runtime_events(context):
                events.append(event)
                if event.type == "graph_failed":
                    status = "failed"
        except Exception as error:
            status = "failed"
            events.append(RuntimeEvent("graph_failed", {"code": "test_run.failed", "message": str(error), "trace_id": trace_id}))

        return self._store.save(replace(run, status=status, events=events))

    def get(self, run_id: str) -> AgentTestRun:
        return self._store.get(run_id)
