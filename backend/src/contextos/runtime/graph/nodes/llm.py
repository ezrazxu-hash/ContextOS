from __future__ import annotations

import inspect
import re
from typing import Any

from contextos.provider.base.chat_client import ChatCompletionClient, LlmProviderError
from contextos.runtime.graph.nodes.protocol import NodeCallable
from contextos.runtime.graph.nodes.references import output_state_key, resolve_reference_value, write_node_output
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
                content = _complete_with_node_options(self._provider, messages, node.config)
            except LlmProviderError as error:
                raise LLMNodeExecutionError("llm.request_failed", node.id, str(error)) from error

            next_state[output_state_key(node)] = content
            write_node_output(next_state, node, content)
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
    prompt_template = str(node.config.get("prompt", node.config.get("prompt_template", "")))
    messages.append({"role": "user", "content": _render_template(prompt_template, values)})
    return messages


def _complete_with_node_options(provider: ChatCompletionClient, messages: list[dict[str, str]], config: dict[str, Any]) -> str:
    options = _node_call_options(config)
    complete = provider.complete
    try:
        parameters = inspect.signature(complete).parameters
    except (TypeError, ValueError):
        parameters = {}
    if any(parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()) or len(parameters) >= 2:
        return complete(messages, options)
    return complete(messages)


def _node_call_options(config: dict[str, Any]) -> dict[str, object]:
    options: dict[str, object] = {}
    for key in ("provider", "model", "temperature", "max_tokens"):
        value = config.get(key)
        if value is not None and value != "":
            options[key] = value
    return options


def _mapped_values(mapping: object, state: dict[str, object]) -> dict[str, object]:
    if not isinstance(mapping, dict):
        return {}
    return {str(key): resolve_reference_value(value, state) for key, value in mapping.items()}


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
