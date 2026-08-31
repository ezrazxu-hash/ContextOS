from __future__ import annotations

from contextos.provider.base.chat_client import ChatCompletionClient, LlmProviderError
from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.nodes.references import output_state_key, resolve_reference_value, write_node_output
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec


class AgentNodeExecutionError(RuntimeError):
    def __init__(self, code: str, node_id: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.node_id = node_id


class AgentNodeExecutor:
    node_type = "agent"

    def __init__(self, provider: ChatCompletionClient) -> None:
        self._provider = provider

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        def execute(state: dict[str, object]) -> dict[str, object]:
            _reject_unsupported_tool_loop(node)
            next_state = dict(state)
            _append_event(next_state, "node_started", node, runtime_context)
            messages = _messages_for_agent(node, state, runtime_context)

            try:
                content = self._provider.complete(messages)
            except LlmProviderError as error:
                raise AgentNodeExecutionError("agent.request_failed", node.id, str(error)) from error

            next_state[output_state_key(node)] = content
            write_node_output(next_state, node, content)
            _append_event(next_state, "token", node, runtime_context, {"content": content})
            _append_event(next_state, "node_finished", node, runtime_context)
            return next_state

        return execute


def _reject_unsupported_tool_loop(node: NodeSpec) -> None:
    if node.config.get("tool_loop") is True or int(node.config.get("max_steps", 1)) > 1:
        raise AgentNodeExecutionError(
            "agent.tool_loop_unsupported",
            node.id,
            "Agent node V1 supports single-turn model calls only",
        )


def _messages_for_agent(node: NodeSpec, state: dict[str, object], runtime_context: RuntimeContext) -> list[dict[str, str]]:
    instruction = str(node.config.get("instruction", ""))
    user_input = resolve_reference_value(node.config.get("input", "$state.input"), state)
    context_lines = _context_lines(runtime_context)
    user_content = "\n".join([*context_lines, str(user_input)])
    return [
        {"role": "system", "content": instruction},
        {"role": "user", "content": user_content},
    ]


def _context_lines(runtime_context: RuntimeContext) -> list[str]:
    context_api = runtime_context.context_api
    if context_api is None or not hasattr(context_api, "build_context"):
        return []
    context = context_api.build_context(runtime_context.session_id, runtime_context.timeline_id)
    return [str(item) for item in context]


def _append_event(
    state: dict[str, object],
    event_type: str,
    node: NodeSpec,
    runtime_context: RuntimeContext,
    data: dict[str, object] | None = None,
) -> None:
    events = list(state.get("runtime_events", []))
    event_data: dict[str, object] = {
        "node_id": node.id,
        "trace_id": runtime_context.trace_id,
    }
    if data:
        event_data.update(data)
    events.append({"type": event_type, "data": event_data})
    state["runtime_events"] = events
