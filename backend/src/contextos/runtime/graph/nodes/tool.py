from __future__ import annotations

import asyncio
from typing import Any

from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec
from contextos.tool.executor_registry import ToolExecutorError, ToolExecutorRegistry


class ToolNodeExecutionError(RuntimeError):
    def __init__(self, code: str, node_id: str, tool_name: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.node_id = node_id
        self.tool_name = tool_name


class ToolNodeExecutor:
    node_type = "tool"

    def __init__(self, tool_executor_registry: ToolExecutorRegistry) -> None:
        self._tool_executor_registry = tool_executor_registry

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        def execute(state: dict[str, object]) -> dict[str, object]:
            next_state = dict(state)
            tool_name = str(node.config.get("tool_name", ""))
            args = _mapped_args(node.config.get("args", {}), state)
            _append_event(next_state, "tool_call", node, runtime_context, tool_name, {"args": args})

            try:
                result = asyncio.run(self._tool_executor_registry.execute(tool_name, args))
            except ToolExecutorError as error:
                raise ToolNodeExecutionError(error.code, node.id, tool_name, str(error)) from error
            except Exception as error:
                raise ToolNodeExecutionError("tool.execution_failed", node.id, tool_name, str(error)) from error

            output_key = str(node.config.get("output_key", "tool_result"))
            next_state[output_key] = result
            _append_event(next_state, "tool_result", node, runtime_context, tool_name, {"result": result})
            return next_state

        return execute


def _mapped_args(mapping: object, state: dict[str, object]) -> dict[str, object]:
    if not isinstance(mapping, dict):
        return {}
    return {str(key): _resolve_state_path(value, state) for key, value in mapping.items()}


def _resolve_state_path(expression: object, state: dict[str, object]) -> object:
    if not isinstance(expression, str) or not expression.startswith("$state."):
        return expression

    value: Any = state
    for part in expression.removeprefix("$state.").split("."):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            value = getattr(value, part, None)
    return value


def _append_event(
    state: dict[str, object],
    event_type: str,
    node: NodeSpec,
    runtime_context: RuntimeContext,
    tool_name: str,
    data: dict[str, object],
) -> None:
    events = list(state.get("runtime_events", []))
    event_data: dict[str, object] = {
        "node_id": node.id,
        "trace_id": runtime_context.trace_id,
        "tool_name": tool_name,
    }
    event_data.update(data)
    events.append({"type": event_type, "data": event_data})
    state["runtime_events"] = events
