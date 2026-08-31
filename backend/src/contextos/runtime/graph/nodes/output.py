from __future__ import annotations

from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.nodes.references import resolve_reference
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec


class OutputNodeExecutionError(RuntimeError):
    def __init__(self, code: str, node_id: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.node_id = node_id


class OutputNodeExecutor:
    node_type = "output"

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        def execute(state: dict[str, object]) -> dict[str, object]:
            next_state = dict(state)
            _append_event(next_state, "node_started", node, runtime_context)
            source = node.config.get("source", "")
            found, value = resolve_reference(source, state)
            if not found:
                raise OutputNodeExecutionError("output.source_missing", node.id, f"Output source not found: {source}")
            next_state["output"] = value
            _append_event(next_state, "node_finished", node, runtime_context)
            return next_state

        return execute

def _append_event(
    state: dict[str, object],
    event_type: str,
    node: NodeSpec,
    runtime_context: RuntimeContext,
) -> None:
    events = list(state.get("runtime_events", []))
    events.append(
        {
            "type": event_type,
            "data": {
                "node_id": node.id,
                "trace_id": runtime_context.trace_id,
            },
        }
    )
    state["runtime_events"] = events
