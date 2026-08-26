from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import Callable
from urllib.parse import parse_qs, urlparse

from contextos.api.routes.debug import get_debug_index
from contextos.api.routes.runtime_snapshot import get_runtime_snapshot
from contextos.api.routes.sessions import get_session, get_session_messages
from contextos.api.streaming.sse import format_sse
from contextos.runtime.checkpoint.model import Checkpoint
from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
from contextos.runtime.debug.projection import DebugProjection
from contextos.runtime.session.message_service import MessageService
from contextos.runtime.session.model import Session, SessionStatus
from contextos.runtime.session.repository import InMemorySessionRepository
from contextos.runtime.session.service import SessionService
from contextos.runtime.session.snapshot_service import RuntimeSnapshotService
from contextos.runtime.timeline.model import Timeline, TimelineStatus
from contextos.runtime.timeline.repository import InMemoryTimelineRepository
from contextos.runtime.trace.collector import TraceCollector
from contextos.runtime.trace.repository import InMemoryTraceRepository


@dataclass
class RuntimeServices:
    session_repository: InMemorySessionRepository
    timeline_repository: InMemoryTimelineRepository
    checkpoint_store: InMemoryCheckpointStore
    message_service: MessageService
    trace_repository: InMemoryTraceRepository

    @property
    def session_service(self) -> SessionService:
        return SessionService(self.session_repository)

    @property
    def snapshot_service(self) -> RuntimeSnapshotService:
        return RuntimeSnapshotService(
            self.session_repository,
            self.timeline_repository,
            self.checkpoint_store,
            self.trace_repository,
        )

    @property
    def debug_projection(self) -> DebugProjection:
        return DebugProjection(
            self.session_repository,
            self.timeline_repository,
            self.checkpoint_store,
            self.message_service,
            self.trace_repository,
        )


class HttpRuntimeHost:
    def __init__(self, host: str = "127.0.0.1", port: int = 8000, services: RuntimeServices | None = None) -> None:
        self._services = services or create_demo_services()
        handler = _handler_factory(self._services)
        self._server = ThreadingHTTPServer((host, port), handler)
        self._thread: Thread | None = None

    @property
    def url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def start(self) -> None:
        self._thread = Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def serve_forever(self) -> None:
        self._server.serve_forever()


def create_http_runtime_host(host: str = "127.0.0.1", port: int = 8000) -> HttpRuntimeHost:
    return HttpRuntimeHost(host=host, port=port)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the ContextOS HTTP runtime host.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    runtime_host = create_http_runtime_host(host=args.host, port=args.port)
    print(f"ContextOS HTTP runtime listening on {runtime_host.url}", flush=True)
    try:
        runtime_host.serve_forever()
    except KeyboardInterrupt:
        pass


def create_demo_services() -> RuntimeServices:
    session_repository = InMemorySessionRepository()
    timeline_repository = InMemoryTimelineRepository()
    checkpoint_store = InMemoryCheckpointStore()
    message_service = MessageService()
    trace_repository = InMemoryTraceRepository()
    services = RuntimeServices(session_repository, timeline_repository, checkpoint_store, message_service, trace_repository)

    created_at = datetime(2026, 8, 26, 0, 0, tzinfo=timezone.utc)
    session_repository.save(
        Session(
            id="demo-session",
            workspace_id="demo-workspace",
            agent_template_id="research-agent",
            current_timeline_id="demo-timeline",
            created_at=created_at,
            status=SessionStatus.ACTIVE,
        )
    )
    timeline_repository.save(
        Timeline(
            id="demo-timeline",
            session_id="demo-session",
            parent_timeline_id=None,
            fork_checkpoint_id=None,
            fork_message_id=None,
            created_at=created_at,
            status=TimelineStatus.ACTIVE,
        )
    )
    checkpoint_store.save(
        Checkpoint(
            id="demo-checkpoint",
            session_id="demo-session",
            timeline_id="demo-timeline",
            graph_state={"node": "report_writer", "status": "ready"},
            message_cursor=2,
            context_revision="demo-context-revision",
            created_at=created_at,
        )
    )
    message_service.create_message(
        session_id="demo-session",
        role="user",
        content="Summarize the incident report and email the team.",
        token_count=8,
    )
    assistant = message_service.create_message(
        session_id="demo-session",
        role="assistant",
        content="The report is ready and the send_report_email tool can notify the team.",
        token_count=12,
        checkpoint_id="demo-checkpoint",
        trace_id="trace-send-report-email",
        tool_call_ids=["tool-call-send-report-email"],
        tool_result_ids=["tool-result-send-report-email"],
    )
    TraceCollector(trace_repository).record_tool_call(
        trace_id="trace-send-report-email",
        session_id="demo-session",
        timeline_id="demo-timeline",
        checkpoint_id="demo-checkpoint",
        component="send_report_email",
        input_payload={"to": "team@example.com", "subject": "Incident report"},
        duration=0.01,
        message_id=assistant.id,
    )
    return services


def _handler_factory(services: RuntimeServices) -> type[BaseHTTPRequestHandler]:
    class ContextOSRequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            segments = [segment for segment in parsed.path.split("/") if segment]

            if parsed.path == "/health":
                self._send_json(200, {"status": "ok"})
                return

            if segments == ["api", "sessions", "demo-session"]:
                self._send_route_response(get_session("demo-session", services.session_service))
                return

            if segments == ["api", "sessions", "demo-session", "messages"]:
                self._send_route_response(get_session_messages("demo-session", services.message_service))
                return

            if segments == ["api", "sessions", "demo-session", "runtime-snapshot"]:
                self._send_route_response(get_runtime_snapshot("demo-session", services.snapshot_service))
                return

            if segments == ["api", "runtime", "sessions", "demo-session"]:
                self._send_route_response(get_runtime_snapshot("demo-session", services.snapshot_service))
                return

            if segments == ["api", "debug", "sessions", "demo-session"]:
                self._send_route_response(
                    get_debug_index(
                        "demo-session",
                        services.debug_projection,
                        trace_id=_first(query, "traceId") or _first(query, "trace_id"),
                        checkpoint_id=_first(query, "checkpointId") or _first(query, "checkpoint_id"),
                        message_id=_first(query, "messageId") or _first(query, "message_id"),
                    )
                )
                return

            if segments == ["sse", "sessions", "demo-session", "chat"]:
                self._send_sse(
                    [
                        format_sse("token", {"message_id": "message-stream", "content": "Report"}),
                        format_sse("token", {"message_id": "message-stream", "content": " sent"}),
                        format_sse("done", {"message_id": "message-stream", "checkpoint_id": "demo-checkpoint"}),
                    ]
                )
                return

            self._send_json(404, {"error": {"code": "route.not_found", "message": "Route not found"}})

        def log_message(self, format: str, *args: object) -> None:
            return

        def _send_route_response(self, response: dict[str, object]) -> None:
            self._send_json(int(response["status"]), response["body"])

        def _send_json(self, status: int, body: object) -> None:
            payload = json.dumps(body, sort_keys=True).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _send_sse(self, frames: list[str]) -> None:
            payload = "".join(frames).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return ContextOSRequestHandler


def _first(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    return values[0] if values else None

