from __future__ import annotations

from collections.abc import Iterator

from contextos.runtime.agent.events import RuntimeEvent, runtime_event_from_dict
from contextos.runtime.agent.protocol import AgentRunContext
from contextos.runtime.graph.cache import CompiledGraphCache
from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.compiler.compile_service import GraphCompileService
from contextos.template.manifest.parser import parse_manifest
from contextos.template.version.service import AgentVersionNotFound, AgentVersionService


class WorkflowAgentRuntime:
    def __init__(
        self,
        agent_version_service: AgentVersionService,
        node_executor_registry: NodeExecutorRegistry,
        compile_service: GraphCompileService | None = None,
        graph_cache: CompiledGraphCache | None = None,
    ) -> None:
        self._agent_version_service = agent_version_service
        self._node_executor_registry = node_executor_registry
        self._compile_service = compile_service or GraphCompileService()
        self._graph_cache = graph_cache

    def stream_runtime_events(self, run_context: AgentRunContext) -> Iterator[RuntimeEvent]:
        agent_version_id = run_context.agent_version_id
        yield RuntimeEvent("graph_started", {"agent_version_id": agent_version_id, "trace_id": run_context.trace_id})
        if not agent_version_id:
            yield _failed_event("agent_version.required", "Agent version id is required", run_context)
            return

        try:
            version = self._agent_version_service.get_version(agent_version_id)
            manifest = parse_manifest(version.manifest_payload)
            graph = self._compile_graph(agent_version_id, manifest)
            state = graph.run(
                {
                    "session_id": run_context.session_id,
                    "timeline_id": run_context.timeline_id,
                    "run_id": run_context.trace_id,
                    "input": run_context.input,
                    "messages": list(run_context.message_history),
                    "node_outputs": {},
                },
                RuntimeContext(run_context.session_id, run_context.timeline_id, run_context.trace_id),
            )
        except AgentVersionNotFound:
            yield _failed_event("agent_version.not_found", f"AgentVersion not found: {agent_version_id}", run_context)
            return
        except Exception as error:
            yield _failed_event(getattr(error, "code", "graph.execution_failed"), str(error), run_context)
            return

        for event in state.get("runtime_events", []):
            if isinstance(event, dict):
                yield runtime_event_from_dict(event)
        yield RuntimeEvent(
            "checkpoint",
            {
                "graph_state": {key: value for key, value in state.items() if key != "runtime_events"},
                "message_cursor": 0,
                "context_revision": run_context.trace_id,
                "agent_template_id": version.agent_template_id,
                "agent_version_id": agent_version_id,
            },
        )
        yield RuntimeEvent(
            "graph_finished",
            {
                "agent_version_id": agent_version_id,
                "trace_id": run_context.trace_id,
                "output": state.get("output"),
            },
        )

    def _compile_graph(self, agent_version_id: str, manifest):
        def compile_now():
            return self._compile_service.compile(manifest, node_executor_registry=self._node_executor_registry)

        if self._graph_cache is None:
            return compile_now()
        return self._graph_cache.get_or_compile(agent_version_id, compile_now)


def _failed_event(code: str, message: str, run_context: AgentRunContext) -> RuntimeEvent:
    return RuntimeEvent(
        "graph_failed",
        {
            "code": code,
            "message": message,
            "agent_version_id": run_context.agent_version_id,
            "trace_id": run_context.trace_id,
        },
    )
