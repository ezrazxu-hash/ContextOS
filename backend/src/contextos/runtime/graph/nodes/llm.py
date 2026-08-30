from __future__ import annotations

import re
from typing import Any

from contextos.provider.base.chat_client import ChatCompletionClient, LlmProviderError
from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.runtime_context import RuntimeContext
from contextos.template.manifest.schema import NodeSpec


class LLMNodeExecutionError(RuntimeError):
    def __init__(self, code: str, node_id: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.node_id = node_id


class LLMNodeExecutor:
    node_type = "llm"

    def __init__(self, provider: ChatCompletionClient) -> None:
        self._provider = provider

    def build(self, node: NodeSpec, runtime_context: RuntimeContext) -> NodeCallable:
        def execute(state: dict[str, object]) -> dict[str, object]:
            next_state = dict(state)
            _append_event(next_state, "node_started", node, runtime_context)
            messages = _messages_for_node(node, state)

            try:
                content = self._provider.complete(messages)
            except LlmProviderError as error:
                raise LLMNodeExecutionError("llm.request_failed", node.id, str(error)) from error

            output_key = str(node.config.get("output_key", "output"))
            next_state[output_key] = content
            _append_event(next_state, "token", node, runtime_context, {"content": content})
            _append_event(next_state, "node_finished", node, runtime_context)
            return next_state

        return execute


def _messages_for_node(node: NodeSpec, state: dict[str, object]) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    system_prompt = node.config.get("system_prompt")
    if system_prompt:
        messages.append({"role": "system", "content": str(system_prompt)})

    values = _mapped_values(node.config.get("input_mapping", {}), state)
    prompt_template = str(node.config.get("prompt_template", ""))
    messages.append({"role": "user", "content": _render_template(prompt_template, values)})
    return messages


def _mapped_values(mapping: object, state: dict[str, object]) -> dict[str, object]:
    if not isinstance(mapping, dict):
        return {}
    return {str(key): _resolve_state_path(str(value), state) for key, value in mapping.items()}


def _resolve_state_path(expression: str, state: dict[str, object]) -> object:
    if not expression.startswith("$state."):
        return expression

    value: Any = state
    for part in expression.removeprefix("$state.").split("."):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            value = getattr(value, part, None)
    return value


def _render_template(template: str, values: dict[str, object]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = values.get(key, "")
        return "" if value is None else str(value)

    return re.sub(r"\{\{\s*([^}]+?)\s*\}\}", replace, template)


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
