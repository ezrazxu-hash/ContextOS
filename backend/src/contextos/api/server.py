from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from functools import cached_property
import argparse
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlparse

from contextos.api.env import load_backend_env
from contextos.api.routes.agents import get_agent_draft, get_agent_version, get_agent_versions, list_agents, post_agent_graph_preview, post_agent_publish, post_agent_validate, put_agent_draft
from contextos.api.routes.agent_test_runs import get_agent_test_run, iter_agent_test_run_event_frames, post_agent_version_test_run
from contextos.api.routes.debug import get_debug_index
from contextos.api.routes.messages import patch_message, soft_delete_message
from contextos.api.routes.runtime_snapshot import get_runtime_snapshot
from contextos.api.routes.chat import iter_chat_event_frames
from contextos.api.routes.sessions import get_session, get_session_messages, list_sessions, patch_session, patch_session_agent, post_session, post_session_message, remove_session
from contextos.api.routes.templates import delete_template, delete_template_node, get_template, list_templates, patch_template, post_template, post_template_compile, post_template_run, post_template_validate, put_template
from contextos.api.routes.tools import list_tools
from contextos.api.routes.timelines import activate_timeline, list_session_timelines, patch_timeline, remove_timeline
from contextos.api.routes.workflow import get_node_catalog
from contextos.api.routes.workflow_runs import get_workflow_artifact_content, get_workflow_run, get_workflow_run_artifacts, post_workflow_run
from contextos.api.routes.workflow_tools import list_workflow_tools
from contextos.api.routes.workflows import get_workflow, get_workflow_version, get_workflow_versions, post_workflow, post_workflow_publish, post_workflow_validate, put_workflow_draft
from contextos.provider.base.chat_client import ChatCompletionClient
from contextos.provider.deepseek_anthropic import create_deepseek_client_from_env, describe_deepseek_env
from contextos.runtime.agent.events import RuntimeEvent, RuntimeEventContractError, runtime_event_to_legacy_event
from contextos.runtime.agent.legacy_runtime import LegacyChatRuntime
from contextos.runtime.agent.protocol import AgentRunContext
from contextos.runtime.agent.resolver import AgentRuntimeResolver
from contextos.runtime.agent.test_run_service import AgentTestRunService, InMemoryAgentTestRunStore
from contextos.runtime.agent.workflow_runtime import WorkflowAgentRuntime
from contextos.runtime.conversation.context_builder import ConversationContextBuilder
from contextos.runtime.conversation.orchestrator import ChatOrchestrator
from contextos.runtime.conversation.repository import InMemoryConversationGroupRepository
from contextos.runtime.conversation.service import ConversationGroupService
from contextos.runtime.checkpoint.model import Checkpoint
from contextos.runtime.checkpoint.service import CheckpointService
from contextos.runtime.checkpoint.store import InMemoryCheckpointStore
from contextos.runtime.debug.projection import DebugProjection
from contextos.runtime.graph.cache import CompiledGraphCache
from contextos.runtime.graph.nodes.condition import ConditionNodeExecutor
from contextos.runtime.graph.nodes.llm import LLMNodeExecutor
from contextos.runtime.graph.nodes.output import OutputNodeExecutor
from contextos.runtime.graph.nodes.prompt import PromptNodeExecutor
from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
from contextos.runtime.graph.nodes.tool import ToolNodeExecutor
from contextos.runtime.persistence.json_store import JsonRuntimeStore
from contextos.runtime.session.message_service import InMemoryMessageRepository, MessageService
from contextos.runtime.session.message_revision_service import MessageRevisionService
from contextos.runtime.session.model import Session, SessionStatus
from contextos.runtime.session.repository import InMemorySessionRepository
from contextos.runtime.session.run_status import SessionRunStatusService
from contextos.runtime.session.service import SessionService
from contextos.runtime.session.snapshot_service import RuntimeSnapshotService
from contextos.runtime.timeline.model import Timeline, TimelineStatus
from contextos.runtime.timeline.repository import InMemoryTimelineRepository
from contextos.runtime.timeline.service import TimelineService
from contextos.runtime.trace.collector import TraceCollector
from contextos.runtime.trace.repository import InMemoryTraceRepository
from contextos.template.extension.registry import ExtensionRegistry
from contextos.template.demo_workflow import (
    DEMO_WORKFLOW_SESSION_ID,
    DEMO_WORKFLOW_TEMPLATE_ID,
    DEMO_WORKFLOW_TIMELINE_ID,
    demo_workflow_manifest,
)
from contextos.template.publish_service import PublishService
from contextos.template.service import TemplateNotFound, TemplateService
from contextos.template.version.repository import InMemoryAgentVersionRepository
from contextos.template.version.service import AgentVersionService
from contextos.tool.executor import FakeReadOnlyTool
from contextos.tool.executor_registry import ToolExecutorRegistry
from contextos.tool.registry.metadata import SideEffect, ToolMetadata
from contextos.tool.registry.registry import ToolRegistry
from contextos.workflow_v2.application.definitions import WorkflowV2DefinitionService
from contextos.workflow_v2.runtime.artifacts import InMemoryWorkflowV2ArtifactStore
from contextos.workflow_v2.runtime.runs import InMemoryWorkflowV2RunStore, WorkflowV2RunService


@dataclass
class RuntimeServices:
    session_repository: InMemorySessionRepository
    timeline_repository: InMemoryTimelineRepository
    checkpoint_store: InMemoryCheckpointStore
    message_service: MessageService
    message_revision_service: MessageRevisionService
    conversation_group_repository: InMemoryConversationGroupRepository
    trace_repository: InMemoryTraceRepository
    template_service: TemplateService
    workflow_v2_definition_service: WorkflowV2DefinitionService
    workflow_v2_run_store: InMemoryWorkflowV2RunStore
    workflow_v2_artifact_store: InMemoryWorkflowV2ArtifactStore
    agent_version_repository: InMemoryAgentVersionRepository
    agent_test_run_store: InMemoryAgentTestRunStore
    graph_cache: CompiledGraphCache
    run_status_service: SessionRunStatusService
    workflow_agent_runtime_enabled: bool = True
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
    def agent_runtime_resolver(self) -> AgentRuntimeResolver:
        return AgentRuntimeResolver(
            legacy_runtime=LegacyChatRuntime(self.chat_orchestrator),
            workflow_runtime=self.workflow_agent_runtime,
            workflow_enabled=self.workflow_agent_runtime_enabled,
            agent_version_loader=self.agent_version_repository.get,
        )

    @property
    def agent_version_service(self) -> AgentVersionService:
        return AgentVersionService(self.agent_version_repository)

    @property
    def workflow_v2_run_service(self) -> WorkflowV2RunService:
        return WorkflowV2RunService(
            self.workflow_v2_definition_service,
            self.workflow_v2_run_store,
            llm_client=self.llm_client,
            tool_registry=self.tool_registry,
            tool_executor_registry=self.tool_executor_registry,
            artifact_store=self.workflow_v2_artifact_store,
        )

    @property
    def publish_service(self) -> PublishService:
        return PublishService(self.template_service, self.agent_version_service, self.extension_registry, self.tool_registry)

    @property
    def node_executor_registry(self) -> NodeExecutorRegistry:
        registry = NodeExecutorRegistry()
        registry.register(PromptNodeExecutor())
        if self.llm_client is not None:
            registry.register(LLMNodeExecutor(self.llm_client))
        registry.register(ToolNodeExecutor(self.tool_executor_registry))
        registry.register(ConditionNodeExecutor())
        registry.register(OutputNodeExecutor())
        return registry

    @property
    def tool_executor_registry(self) -> ToolExecutorRegistry:
        return ToolExecutorRegistry([FakeReadOnlyTool("context.echo").as_executor()])

    @cached_property
    def workflow_agent_runtime(self) -> WorkflowAgentRuntime:
        return WorkflowAgentRuntime(
            self.agent_version_service,
            self.node_executor_registry,
            graph_cache=self.graph_cache,
        )

    @cached_property
    def agent_test_run_service(self) -> AgentTestRunService:
        return AgentTestRunService(self.workflow_agent_runtime, self.agent_test_run_store, message_service=self.message_service)

    @property
    def trace_collector(self) -> TraceCollector:
        return TraceCollector(self.trace_repository)

    @property
    def extension_registry(self) -> ExtensionRegistry:
        return ExtensionRegistry()

    @property
    def tool_registry(self) -> ToolRegistry:
        return ToolRegistry(
            [
                ToolMetadata(
                    tool_id="context.echo",
                    name="Context Echo",
                    description="Echoes the query argument for workflow smoke tests.",
                    side_effect=SideEffect.READ,
                    idempotent=True,
                    input_schema={"type": "object", "required": ["query"], "properties": {"query": {"type": "string"}}},
                    output_schema={"type": "object", "properties": {"echo": {"type": "string"}}},
                )
            ]
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


def create_http_runtime_host(
    host: str = "127.0.0.1",
    port: int = 8000,
    llm_client: ChatCompletionClient | None = None,
    storage_path: str | Path | None = None,
    workflow_agent_runtime_enabled: bool | None = None,
) -> HttpRuntimeHost:
    services = create_demo_services(
        llm_client=llm_client,
        storage_path=storage_path,
        workflow_agent_runtime_enabled=workflow_agent_runtime_enabled,
    )
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
    workflow_agent_runtime_enabled: bool | None = None,
) -> RuntimeServices:
    store = JsonRuntimeStore(storage_path) if storage_path is not None else None
    session_repository = InMemorySessionRepository(store)
    timeline_repository = InMemoryTimelineRepository(store)
    checkpoint_store = InMemoryCheckpointStore(store)
    message_service = MessageService(InMemoryMessageRepository(store))
    message_revision_service = MessageRevisionService()
    conversation_group_repository = InMemoryConversationGroupRepository(store)
    trace_repository = InMemoryTraceRepository()
    template_service = TemplateService(store)
    workflow_v2_definition_service = WorkflowV2DefinitionService(store)
    workflow_v2_run_store = InMemoryWorkflowV2RunStore()
    workflow_v2_artifact_store = InMemoryWorkflowV2ArtifactStore()
    agent_version_repository = InMemoryAgentVersionRepository(store)
    agent_test_run_store = InMemoryAgentTestRunStore()
    graph_cache = CompiledGraphCache()
    run_status_service = SessionRunStatusService()
    services = RuntimeServices(
        session_repository,
        timeline_repository,
        checkpoint_store,
        message_service,
        message_revision_service,
        conversation_group_repository,
        trace_repository,
        template_service,
        workflow_v2_definition_service,
        workflow_v2_run_store,
        workflow_v2_artifact_store,
        agent_version_repository,
        agent_test_run_store,
        graph_cache,
        run_status_service,
        _workflow_agent_runtime_enabled(workflow_agent_runtime_enabled),
        llm_client=llm_client or create_deepseek_client_from_env(),
    )

    _ensure_demo_workflow(services)
    if store is not None and store.loaded_existing_state:
        return services

    _ensure_demo_workflow_session(services)
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


def _ensure_demo_workflow(services: RuntimeServices) -> None:
    manifest = demo_workflow_manifest()
    try:
        record = services.template_service.get(DEMO_WORKFLOW_TEMPLATE_ID)
    except TemplateNotFound:
        record = services.template_service.save(manifest)

    if record.draft_manifest_payload is None:
        record = services.template_service.save_draft(DEMO_WORKFLOW_TEMPLATE_ID, manifest)

    active_version_exists = (
        record.active_version_id is not None
        and services.agent_version_repository.get(record.active_version_id) is not None
    )
    if not active_version_exists:
        services.publish_service.publish(DEMO_WORKFLOW_TEMPLATE_ID)


def _ensure_demo_workflow_session(services: RuntimeServices) -> None:
    if services.session_repository.get(DEMO_WORKFLOW_SESSION_ID) is not None:
        return

    record = services.template_service.get(DEMO_WORKFLOW_TEMPLATE_ID)
    if record.active_version_id is None:
        return

    created_at = datetime(2026, 8, 26, 0, 1, tzinfo=timezone.utc)
    services.session_repository.save(
        Session(
            id=DEMO_WORKFLOW_SESSION_ID,
            workspace_id="demo-workspace",
            agent_template_id=DEMO_WORKFLOW_TEMPLATE_ID,
            current_timeline_id=DEMO_WORKFLOW_TIMELINE_ID,
            created_at=created_at,
            status=SessionStatus.ACTIVE,
            title="Demo Workflow",
            metadata={"source": "demo-workflow-seed"},
            agent_version_id=record.active_version_id,
        )
    )
    services.timeline_repository.save(
        Timeline(
            id=DEMO_WORKFLOW_TIMELINE_ID,
            session_id=DEMO_WORKFLOW_SESSION_ID,
            parent_timeline_id=None,
            fork_checkpoint_id=None,
            fork_message_id=None,
            created_at=created_at,
            status=TimelineStatus.ACTIVE,
        )
    )


def _default_runtime_state_path() -> Path:
    configured = os.environ.get("CONTEXTOS_RUNTIME_STATE_PATH")
    if configured:
        return Path(configured)
    return Path("backend") / ".contextos" / "runtime-state.json"


def _workflow_agent_runtime_enabled(configured: bool | None) -> bool:
    if configured is not None:
        return configured
    value = os.environ.get("WORKFLOW_AGENT_RUNTIME_ENABLED")
    if value is None:
        return True
    return value.strip().lower() not in {"0", "false", "no", "off"}


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

            if len(segments) == 2 and segments == ["api", "agents"]:
                self._send_route_response(list_agents(services.template_service, services.agent_version_service))
                return

            if len(segments) == 3 and segments == ["api", "workflow", "node-catalog"]:
                self._send_route_response(get_node_catalog())
                return

            if len(segments) == 2 and segments == ["api", "tools"]:
                self._send_route_response(list_tools(services.tool_registry))
                return

            if len(segments) == 2 and segments == ["api", "workflow-tools"]:
                self._send_route_response(list_workflow_tools(services.tool_registry))
                return

            if len(segments) == 4 and segments[:2] == ["api", "agents"] and segments[3] == "draft":
                self._send_route_response(get_agent_draft(segments[2], services.template_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "agents"] and segments[3] == "versions":
                self._send_route_response(get_agent_versions(segments[2], services.agent_version_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "agent-versions"]:
                self._send_route_response(get_agent_version(segments[2], services.agent_version_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "templates"]:
                self._send_route_response(get_template(segments[2], services.template_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "workflows"]:
                self._send_route_response(get_workflow(segments[2], services.workflow_v2_definition_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "workflows"] and segments[3] == "versions":
                self._send_route_response(get_workflow_versions(segments[2], services.workflow_v2_definition_service))
                return

            if len(segments) == 5 and segments[:2] == ["api", "workflows"] and segments[3] == "versions":
                self._send_route_response(get_workflow_version(segments[2], int(segments[4]), services.workflow_v2_definition_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "workflow-runs"]:
                self._send_route_response(get_workflow_run(segments[2], services.workflow_v2_run_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "workflow-runs"] and segments[3] == "artifacts":
                self._send_route_response(get_workflow_run_artifacts(segments[2], services.workflow_v2_run_service, services.workflow_v2_artifact_store))
                return

            if len(segments) == 4 and segments[:2] == ["api", "workflow-artifacts"] and segments[3] == "content":
                response = get_workflow_artifact_content(segments[2], services.workflow_v2_artifact_store)
                if int(response["status"]) != 200:
                    self._send_route_response(response)
                    return
                self._send_bytes(int(response["status"]), bytes(response["body"]), str(response["contentType"]))
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
                session = services.session_repository.get(segments[2])
                if session is None:
                    self._send_json(404, {"error": {"code": "session.not_found", "message": "Session not found"}})
                    return
                timeline_id = _first(query, "timelineId") or _first(query, "timeline_id") or session.current_timeline_id
                if timeline_id is None:
                    self._send_json(200, {"items": []})
                    return
                self._send_json(200, {"items": services.conversation_context_builder.build_context_items(segments[2], timeline_id)})
                return

            if len(segments) == 4 and segments[:2] == ["api", "sessions"] and segments[3] == "runtime-snapshot":
                self._send_route_response(get_runtime_snapshot(segments[2], services.snapshot_service))
                return

            if len(segments) == 4 and segments[:3] == ["api", "runtime", "sessions"]:
                self._send_route_response(get_runtime_snapshot(segments[3], services.snapshot_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "agent-test-runs"]:
                self._send_route_response(get_agent_test_run(segments[2], services.agent_test_run_service))
                return

            if len(segments) == 3 and segments[:2] == ["sse", "agent-test-runs"]:
                self._send_sse(iter_agent_test_run_event_frames(segments[2], services.agent_test_run_service))
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
                response = post_session(payload, services.session_service, agent_version_service=services.agent_version_service)
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

            if len(segments) == 2 and segments == ["api", "workflows"]:
                self._send_route_response(post_workflow(payload, services.workflow_v2_definition_service))
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

            if len(segments) == 4 and segments[:2] == ["api", "agents"] and segments[3] == "validate":
                self._send_route_response(
                    post_agent_validate(
                        segments[2],
                        payload,
                        services.template_service,
                        extension_registry=services.extension_registry,
                        tool_registry=services.tool_registry,
                    )
                )
                return

            if len(segments) == 4 and segments[:2] == ["api", "workflows"] and segments[3] == "validate":
                self._send_route_response(post_workflow_validate(segments[2], payload, services.workflow_v2_definition_service, services.tool_registry))
                return

            if len(segments) == 4 and segments[:2] == ["api", "workflows"] and segments[3] == "publish":
                self._send_route_response(post_workflow_publish(segments[2], services.workflow_v2_definition_service, services.tool_registry))
                return

            if len(segments) == 4 and segments[:2] == ["api", "workflows"] and segments[3] == "runs":
                self._send_route_response(post_workflow_run(segments[2], payload, services.workflow_v2_run_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "agents"] and segments[3] == "graph-preview":
                self._send_route_response(
                    post_agent_graph_preview(
                        segments[2],
                        payload,
                        extension_registry=services.extension_registry,
                        tool_registry=services.tool_registry,
                    )
                )
                return

            if len(segments) == 4 and segments[:2] == ["api", "agents"] and segments[3] == "publish":
                self._send_route_response(post_agent_publish(segments[2], services.publish_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "agent-versions"] and segments[3] == "test-runs":
                self._send_route_response(post_agent_version_test_run(segments[2], payload, services.agent_test_run_service))
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

            if len(segments) == 4 and segments[:2] == ["api", "timelines"] and segments[3] == "activate":
                self._send_route_response(activate_timeline(segments[2], services.timeline_service))
                return

            self._send_json(404, {"error": {"code": "route.not_found", "message": "Route not found"}})

        def do_PUT(self) -> None:
            parsed = urlparse(self.path)
            segments = [segment for segment in parsed.path.split("/") if segment]
            payload = self._read_json_body()

            if len(segments) == 3 and segments[:2] == ["api", "templates"]:
                self._send_route_response(put_template(segments[2], payload, services.template_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "agents"] and segments[3] == "draft":
                self._send_route_response(put_agent_draft(segments[2], payload, services.template_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "workflows"] and segments[3] == "draft":
                self._send_route_response(put_workflow_draft(segments[2], payload, services.workflow_v2_definition_service))
                return

            self._send_json(404, {"error": {"code": "route.not_found", "message": "Route not found"}})

        def do_PATCH(self) -> None:
            parsed = urlparse(self.path)
            segments = [segment for segment in parsed.path.split("/") if segment]
            payload = self._read_json_body()

            if len(segments) == 3 and segments[:2] == ["api", "messages"]:
                self._send_route_response(
                    patch_message(
                        segments[2],
                        payload,
                        services.message_service,
                        services.message_revision_service,
                        timeline_service=services.timeline_service,
                        conversation_group_service=services.conversation_group_service,
                    )
                )
                return

            if len(segments) == 3 and segments[:2] == ["api", "sessions"]:
                self._send_route_response(patch_session(segments[2], payload, services.session_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "templates"]:
                self._send_route_response(patch_template(segments[2], payload, services.template_service))
                return

            if len(segments) == 4 and segments[:2] == ["api", "sessions"] and segments[3] == "agent":
                self._send_route_response(
                    patch_session_agent(
                        segments[2],
                        payload,
                        services.session_service,
                        services.agent_version_service,
                        run_status_service=services.run_status_service,
                    )
                )
                return

            if len(segments) == 3 and segments[:2] == ["api", "timelines"]:
                self._send_route_response(patch_timeline(segments[2], payload, services.timeline_service))
                return

            self._send_json(404, {"error": {"code": "route.not_found", "message": "Route not found"}})

        def do_DELETE(self) -> None:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            segments = [segment for segment in parsed.path.split("/") if segment]

            if len(segments) == 3 and segments[:2] == ["api", "messages"]:
                mode = _first(query, "mode")
                semantic_delete = mode == "semantic" or (_first(query, "semantic") or "").lower() in ("1", "true", "yes")
                self._send_route_response(
                    soft_delete_message(
                        segments[2],
                        services.message_service,
                        services.conversation_group_service,
                        timeline_service=services.timeline_service,
                        semantic_delete=semantic_delete,
                    )
                )
                return

            if len(segments) == 3 and segments[:2] == ["api", "timelines"]:
                self._send_route_response(remove_timeline(segments[2], services.timeline_service))
                return

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

            if len(segments) == 5 and segments[:2] == ["api", "templates"] and segments[3] == "nodes":
                self._send_route_response(delete_template_node(segments[2], segments[4], services.template_service))
                return

            if len(segments) == 3 and segments[:2] == ["api", "templates"]:
                self._send_route_response(delete_template(segments[2], services.template_service))
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

        def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

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
    trace_id = "trace-chat-response"
    session = services.session_repository.get(session_id)
    runtime = services.agent_runtime_resolver.resolve(session)
    run_context = AgentRunContext(
        session_id,
        timeline_id,
        trace_id,
        agent_version_id=_session_agent_version_id(session),
        input=_latest_user_input(session_id, timeline_id, services),
        message_history=_message_history(session_id, timeline_id, services),
    )
    saw_token = False
    for event in runtime.stream_runtime_events(run_context):
        event = _attach_latest_group_to_terminal_event(event, session_id, timeline_id, services)
        if event.type == "token":
            saw_token = True
        if event.type == "graph_finished" and not saw_token and event.data.get("output") is not None:
            saw_token = True
            yield runtime_event_to_legacy_event(
                RuntimeEvent("token", {"content": str(event.data.get("output", "")), "trace_id": trace_id})
            )
        try:
            yield runtime_event_to_legacy_event(event)
        except RuntimeEventContractError:
            continue


def _session_agent_version_id(session) -> str | None:
    direct_value = getattr(session, "agent_version_id", None)
    if direct_value:
        return str(direct_value)
    metadata = getattr(session, "metadata", {})
    metadata_value = metadata.get("agent_version_id") if isinstance(metadata, dict) else None
    return str(metadata_value) if metadata_value else None


def _message_history(session_id: str, timeline_id: str, services: RuntimeServices) -> list[dict[str, str]]:
    builder = getattr(services, "conversation_context_builder", None)
    if builder is None:
        return []
    return builder.build_llm_messages(session_id, timeline_id)


def _latest_user_input(session_id: str, timeline_id: str, services: RuntimeServices) -> str:
    if not hasattr(services, "message_service"):
        return ""
    messages, _ = services.message_service.list_messages(session_id, limit=1000, timeline_id=timeline_id)
    for message in reversed(messages):
        role = getattr(message.role, "value", message.role)
        if str(role) == "user":
            return message.content
    return ""


def _attach_latest_group_to_terminal_event(
    event: RuntimeEvent,
    session_id: str,
    timeline_id: str,
    services: RuntimeServices,
) -> RuntimeEvent:
    if event.type != "graph_finished" or event.data.get("group_id"):
        return event
    if not hasattr(services, "conversation_group_service"):
        return event
    group = services.conversation_group_service.latest_group(session_id, timeline_id)
    if group is None:
        return event
    return RuntimeEvent(event.type, {**event.data, "group_id": group.id})

