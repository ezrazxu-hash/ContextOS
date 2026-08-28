from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import argparse
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlparse

from contextos.api.env import load_backend_env
from contextos.api.routes.debug import get_debug_index
from contextos.api.routes.runtime_snapshot import get_runtime_snapshot
from contextos.api.routes.chat import iter_chat_event_frames
from contextos.api.routes.sessions import get_session, get_session_messages, list_sessions, post_session, post_session_message, remove_session
from contextos.api.routes.templates import get_template, list_templates, post_template, post_template_compile, post_template_run, post_template_validate, put_template
from contextos.api.routes.timelines import list_session_timelines
from contextos.provider.base.chat_client import ChatCompletionClient
from contextos.provider.deepseek_anthropic import create_deepseek_client_from_env, describe_deepseek_env
from contextos.runtime.conversation.context_builder import ConversationContextBuilder
from contextos.runtime.conversation.orchestrator import ChatOrchestrator
from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
from contextos.runtime.conversation.service import ConversationGroupService
from contextos.runtime.checkpoint.model import Checkpoint
from contextos.runtime.checkpoint.service import CheckpointService
from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
from contextos.runtime.debug.projection import DebugProjection
from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.runtime.session.message_service import InMemoryMessageRepository, MessageService
from contextos.runtime.session.model import Session, SessionStatus
from contextos.runtime.session.repository import InMemorySessionRepository
from contextos.runtime.session.service import SessionService
from contextos.runtime.session.snapshot_service import RuntimeSnapshotService
from contextos.runtime.timeline.model import Timeline, TimelineStatus
from contextos.runtime.timeline.repository import InMemoryTimelineRepository
from contextos.runtime.timeline.service import TimelineService
from contextos.runtime.trace.collector import TraceCollector
from contextos.runtime.trace.repository import InMemoryTraceRepository
from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.service import TemplateService
from contextos.tool.registry.registry import ToolRegistry


@dataclass
class RuntimeServices:
    session_repository: InMemorySessionRepository
    timeline_repository: InMemoryTimelineRepository
    checkpoint_store: InMemoryCheckpointStore
    message_service: MessageService
    conversation_group_repository: InMemoryConversationGroupRepository
    trace_repository: InMemoryTraceRepository
    template_service: TemplateService
    llm_client: ChatCompletionClient | None = None

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
    def checkpoint_service(self) -> CheckpointService:
        return CheckpointService(self.checkpoint_store)

    @property
    def timeline_service(self) -> TimelineService:
        return TimelineService(self.timeline_repository, self.session_repository)

    @property
    def conversation_group_service(self) -> ConversationGroupService:
        return ConversationGroupService(self.conversation_group_repository)

    @property
    def conversation_context_builder(self) -> ConversationContextBuilder:
        return ConversationContextBuilder(self.conversation_group_repository, self.message_service)

    @property
    def chat_orchestrator(self) -> ChatOrchestrator:
        return ChatOrchestrator(
            self.conversation_context_builder,
            self.conversation_group_service,
            self.message_service,
            self.llm_client,
        )

    @property
    def trace_collector(self) -> TraceCollector:
        return TraceCollector(self.trace_repository)

    @property
    def extension_registry(self) -> ExtensionRegistry:
        return ExtensionRegistry()

    @property
    def tool_registry(self) -> ToolRegistry:
        return ToolRegistry()

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


def create_http_runtime_host(
    host: str = "127.0.0.1",
    port: int = 8000,
    llm_client: ChatCompletionClient | None = None,
    storage_path: str | Path | None = None,
) -> HttpRuntimeHost:
    services = create_demo_services(llm_client=llm_client, storage_path=storage_path)
    return HttpRuntimeHost(host=host, port=port, services=services)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the ContextOS HTTP runtime host.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    load_backend_env()
    runtime_host = create_http_runtime_host(host=args.host, port=args.port, storage_path=_default_runtime_state_path())
    print(f"ContextOS HTTP runtime listening on {runtime_host.url}", flush=True)
    print(describe_deepseek_env(), flush=True)
    try:
        runtime_host.serve_forever()
    except KeyboardInterrupt:
        pass


def create_demo_services(
    llm_client: ChatCompletionClient | None = None,
    storage_path: str | Path | None = None,
) -> RuntimeServices:
    store = JsonRuntimeStore(storage_path) if storage_path is not None else None
    session_repository = InMemorySessionRepository(store)
    timeline_repository = InMemoryTimelineRepository(store)
    checkpoint_store = InMemoryCheckpointStore(store)
    message_service = MessageService(InMemoryMessageRepository(store))
    conversation_group_repository = InMemoryConversationGroupRepository(store)
    trace_repository = InMemoryTraceRepository()
    template_service = TemplateService(store)
    services = RuntimeServices(
        session_repository,
        timeline_repository,
        checkpoint_store,
        message_service,
        conversation_group_repository,
        trace_repository,
        template_service,
        llm_client=llm_client or create_deepseek_client_from_env(),
    )

    if store is not None and store.loaded_existing_state:
        return services

    if session_repository.get("demo-session") is not None:
        return services

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
    group = services.conversation_group_service.start_turn(
        "demo-session",
        "demo-timeline",
        "demo-user-message",
        group_id="demo-group-1",
    )
    message_service.create_message(
        message_id="demo-user-message",
        session_id="demo-session",
        timeline_id="demo-timeline",
        group_id=group.id,
        role="user",
        content="Summarize the incident report and email the team.",
        token_count=8,
        context_group_ids=[group.id],
    )
    assistant = message_service.create_message(
        message_id="demo-assistant-message",
        session_id="demo-session",
        timeline_id="demo-timeline",
        group_id=group.id,
        role="assistant",
        content="The report is ready and the send_report_email tool can notify the team.",
        token_count=12,
        context_group_ids=[group.id],
        checkpoint_id="demo-checkpoint",
        trace_id="trace-send-report-email",
        tool_call_ids=["tool-call-send-report-email"],
        tool_result_ids=["tool-result-send-report-email"],
    )
    services.conversation_group_service.append_message(group.id, assistant.id)
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


def _default_runtime_state_path() -> Path:
    configured = os.environ.get("CONTEXTOS_RUNTIME_STATE_PATH")
    if configured:
        return Path(configured)
    return Path("backend") / ".contextos" / "runtime-state.json"


def _handler_factory(services: RuntimeServices) -> type[BaseHTTPRequestHandler]:
    class ContextOSRequestHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            segments = [segment for segment in parsed.path.split("/") if segment]

            if parsed.path == "/health":
                self._send_json(200, {"status": "ok"})
                return

            if len(segments) == 2 and segments == ["api", "sessions"]:
                self._send_route_response(list_sessions(services.session_service))
                return

            if len(segments) == 2 and segments == ["api", "templates"]:
                self._send_route_response(list_templates(services.template_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "templates"]:
                self._send_route_response(get_template(segments[2], services.template_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "sessions"]:
                self._send_route_response(get_session(segments[2], services.session_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "sessions"] and segments[3] == "messages":
                timeline_id = _first(query, "timelineId") or _first(query, "timeline_id")
                self._send_route_response(get_session_messages(segments[2], services.message_service, timeline_id=timeline_id))
                return

            if len(segments) == 4 and segments[:2] == ["api", "sessions"] and segments[3] == "timelines":
                self._send_route_response(list_session_timelines(segments[2], services.timeline_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "sessions"] and segments[3] == "context":
                self._send_json(200, {"items": []})
                return

            if len(segments) == 4 and segments[:2] == ["api", "sessions"] and segments[3] == "runtime-snapshot":
                self._send_route_response(get_runtime_snapshot(segments[2], services.snapshot_service))
                return

            if len(segments) == 4 and segments[:3] == ["api", "runtime", "sessions"]:
                self._send_route_response(get_runtime_snapshot(segments[3], services.snapshot_service))
                return

            if len(segments) == 4 and segments[:3] == ["api", "debug", "sessions"]:
                self._send_route_response(
                    get_debug_index(
                        segments[3],
                        services.debug_projection,
                        trace_id=_first(query, "traceId") or _first(query, "trace_id"),
                        checkpoint_id=_first(query, "checkpointId") or _first(query, "checkpoint_id"),
                        message_id=_first(query, "messageId") or _first(query, "message_id"),
                    )
                )
                return

            if len(segments) == 4 and segments[:2] == ["sse", "sessions"] and segments[3] == "chat":
                timeline_id = _first(query, "timelineId") or _first(query, "timeline_id") or "demo-timeline"
                self._send_sse(
                    iter_chat_event_frames(
                        session_id=segments[2],
                        timeline_id=timeline_id,
                        trace_id="trace-chat-response",
                        runtime_events=_chat_runtime_events(
                            segments[2],
                            timeline_id,
                            services,
                        ),
                        message_service=services.message_service,
                        trace_collector=services.trace_collector,
                        checkpoint_service=services.checkpoint_service,
                        conversation_group_service=services.conversation_group_service,
                    )
                )
                return

            self._send_json(404, {"error": {"code": "route.not_found", "message": "Route not found"}})

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            segments = [segment for segment in parsed.path.split("/") if segment]
            payload = self._read_json_body()

            if len(segments) == 2 and segments == ["api", "sessions"]:
                response = post_session(payload, services.session_service)
                if int(response["status"]) == 201:
                    session_id = str(response["body"]["id"])
                    timeline = services.timeline_service.create_initial_timeline(session_id)
                    response["body"] = services.session_service.get_session(session_id).to_dict()
                    response["body"]["current_timeline_id"] = timeline.id
                self._send_route_response(response)
                return

            if len(segments) == 2 and segments == ["api", "templates"]:
                self._send_route_response(post_template(payload, services.template_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "templates"] and segments[3] == "validate":
                self._send_route_response(
                    post_template_validate(
                        segments[2],
                        services.template_service,
                        extension_registry=services.extension_registry,
                        tool_registry=services.tool_registry,
                    )
                )
                return

            if len(segments) == 4 and segments[:2] == ["api", "templates"] and segments[3] == "compile":
                self._send_route_response(
                    post_template_compile(
                        segments[2],
                        services.template_service,
                        extension_registry=services.extension_registry,
                        tool_registry=services.tool_registry,
                    )
                )
                return

            if len(segments) == 4 and segments[:2] == ["api", "templates"] and segments[3] == "run":
                self._send_route_response(
                    post_template_run(
                        segments[2],
                        payload,
                        services.template_service,
                        extension_registry=services.extension_registry,
                        tool_registry=services.tool_registry,
                    )
                )
                return

            if len(segments) == 4 and segments[:2] == ["api", "sessions"] and segments[3] == "messages":
                session = services.session_repository.get(segments[2])
                if session is None:
                    self._send_json(404, {"error": {"code": "session.not_found", "message": "Session not found"}})
                    return
                timeline_id = str(payload.get("timeline_id") or payload.get("timelineId") or session.current_timeline_id or "")
                timeline = services.timeline_repository.get(timeline_id) if timeline_id else None
                if timeline is None or timeline.session_id != segments[2]:
                    self._send_json(400, {"error": {"code": "timeline.invalid", "message": "Timeline does not belong to this session"}})
                    return
                payload["timeline_id"] = timeline.id
                self._send_route_response(
                    post_session_message(
                        segments[2],
                        payload,
                        services.message_service,
                        conversation_group_service=services.conversation_group_service,
                        default_timeline_id=timeline.id,
                    )
                )
                return

            self._send_json(404, {"error": {"code": "route.not_found", "message": "Route not found"}})

        def do_PUT(self) -> None:
            parsed = urlparse(self.path)
            segments = [segment for segment in parsed.path.split("/") if segment]
            payload = self._read_json_body()

            if len(segments) == 3 and segments[:2] == ["api", "templates"]:
                self._send_route_response(put_template(segments[2], payload, services.template_service))
                return

            self._send_json(404, {"error": {"code": "route.not_found", "message": "Route not found"}})

        def do_DELETE(self) -> None:
            parsed = urlparse(self.path)
            segments = [segment for segment in parsed.path.split("/") if segment]

            if len(segments) == 3 and segments[:2] == ["api", "sessions"]:
                self._send_route_response(
                    remove_session(
                        segments[2],
                        services.session_service,
                        services.timeline_repository,
                        services.message_service,
                        services.conversation_group_repository,
                        services.checkpoint_store,
                    )
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

        def _read_json_body(self) -> dict[str, object]:
            length = int(self.headers.get("Content-Length", "0"))
            if length == 0:
                return {}
            try:
                return json.loads(self.rfile.read(length).decode("utf-8-sig"))
            except json.JSONDecodeError:
                return {}

        def _send_sse(self, frames) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            for frame in frames:
                self.wfile.write(frame.encode("utf-8"))
                self.wfile.flush()

    return ContextOSRequestHandler


def _first(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    return values[0] if values else None


def _chat_runtime_events(
    session_id: str,
    timeline_id: str,
    services: RuntimeServices,
):
    yield from services.chat_orchestrator.stream_runtime_events(session_id, timeline_id, "trace-chat-response")

