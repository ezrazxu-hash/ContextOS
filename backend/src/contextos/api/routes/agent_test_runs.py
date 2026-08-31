from __future__ import annotations

from collections.abc import Iterator

from contextos.api.streaming.sse import format_sse
from contextos.runtime.agent.test_run_service import AgentTestRunNotFound, AgentTestRunService


def post_agent_version_test_run(agent_version_id: str, payload: dict[str, object], service: AgentTestRunService) -> dict[str, object]:
    run = service.start(agent_version_id=agent_version_id, input=str(payload.get("input", "")))
    return {"status": 201, "body": _run_body(run)}


def get_agent_test_run(run_id: str, service: AgentTestRunService) -> dict[str, object]:
    try:
        run = service.get(run_id)
    except AgentTestRunNotFound:
        return {"status": 404, "body": {"error": {"code": "agent_test_run.not_found", "message": "Agent test run not found"}}}
    return {"status": 200, "body": _run_body(run)}


def iter_agent_test_run_event_frames(run_id: str, service: AgentTestRunService) -> Iterator[str]:
    run = service.get(run_id)
    for event in run.events:
        yield format_sse(event.type, event.data)


def _run_body(run) -> dict[str, object]:
    return {
        "id": run.id,
        "run_id": run.id,
        "agent_version_id": run.agent_version_id,
        "status": run.status,
        "trace_id": run.trace_id,
        "output": run.output,
        "events": [event.to_dict() for event in run.events],
    }
