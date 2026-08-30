from dataclasses import dataclass
from typing import Protocol

from contextos.runtime.checkpoint.service import CheckpointService
from contextos.runtime.graph.runtime_context import RuntimeContext


class GraphRunner(Protocol):
    def run(self, graph_state: dict[str, object], runtime_context: RuntimeContext) -> dict[str, object]:
        ...


class ContextCompilerPort(Protocol):
    def compile(self, graph_state: dict[str, object]) -> object:
        ...


@dataclass(frozen=True)
class ExecutionResult:
    graph_state: dict[str, object]
    checkpoint_id: str
    runtime_context: RuntimeContext


class RuntimeExecutor:
    def __init__(
        self,
        graph_runner: GraphRunner,
        checkpoint_service: CheckpointService,
        context_compiler: ContextCompilerPort | None = None,
    ) -> None:
        self._graph_runner = graph_runner
        self._checkpoint_service = checkpoint_service
        self._context_compiler = context_compiler

    def run(
        self,
        session_id: str,
        timeline_id: str,
        trace_id: str,
        graph_state: dict[str, object],
        message_cursor: int,
        context_revision: str,
        parent_checkpoint_id: str | None = None,
        agent_template_id: str | None = None,
        agent_version_id: str | None = None,
    ) -> ExecutionResult:
        runtime_context = RuntimeContext(
            session_id=session_id,
            timeline_id=timeline_id,
            trace_id=trace_id,
        )
        runner_state = graph_state
        if self._context_compiler is not None:
            runner_state = {
                **graph_state,
                "compiled_context": self._context_compiler.compile(graph_state),
            }
        completed_state = self._graph_runner.run(runner_state, runtime_context)
        checkpoint = self._checkpoint_service.save_checkpoint(
            session_id=session_id,
            timeline_id=timeline_id,
            graph_state=completed_state,
            message_cursor=message_cursor,
            context_revision=context_revision,
            parent_checkpoint_id=parent_checkpoint_id,
            agent_template_id=agent_template_id,
            agent_version_id=agent_version_id,
        )
        return ExecutionResult(
            graph_state=completed_state,
            checkpoint_id=checkpoint.id,
            runtime_context=runtime_context,
        )
