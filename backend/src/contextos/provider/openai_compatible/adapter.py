from html import escape
import json
from typing import Any

from contextos.context.compiler.tool_validator import ValidationIssue, validate_tool_dependencies
from contextos.provider.base.ir import (
    AssistantMessage,
    ContextPlaceholder,
    ContextReference,
    SystemInstruction,
    ToolCall,
    ToolResult,
    UserMessage,
)
from contextos.provider.base.token_counter import ProviderCapability, count_ir_tokens


class OpenAICompatibleAdapter:
    def __init__(self, capability: ProviderCapability | None = None) -> None:
        self._capability = capability or ProviderCapability(max_context_tokens=128000)

    def compile_message(
        self,
        message: SystemInstruction | UserMessage | AssistantMessage | ContextReference,
    ) -> dict[str, Any]:
        if isinstance(message, SystemInstruction):
            return {"role": "system", "content": message.content}
        if isinstance(message, UserMessage):
            return {"role": "user", "content": message.content}
        if isinstance(message, ContextReference):
            return {"role": "system", "content": f"[context-reference:{message.target_id}] {message.label}"}
        if isinstance(message, AssistantMessage):
            payload: dict[str, Any] = {"role": "assistant", "content": message.content}
            if message.tool_calls:
                payload["tool_calls"] = [self.compile_tool_call(tool_call) for tool_call in message.tool_calls]
            return payload
        raise TypeError(f"unsupported message type: {type(message).__name__}")

    def compile_tool_call(self, tool_call: ToolCall) -> dict[str, Any]:
        return {
            "id": tool_call.call_id,
            "type": "function",
            "function": {
                "name": tool_call.name,
                "arguments": json.dumps(tool_call.arguments, sort_keys=True),
            },
        }

    def compile_tool_result(self, tool_result: ToolResult) -> dict[str, Any]:
        return {
            "role": "tool",
            "tool_call_id": tool_result.call_id,
            "content": _content_to_text(tool_result.content),
        }

    def compile_placeholder(self, placeholder: ContextPlaceholder) -> dict[str, Any]:
        attrs = [
            f'id="{escape(placeholder.placeholder_id)}"',
            f'group-id="{escape(placeholder.group_id)}"',
            f'restorable="{"true" if placeholder.restorable else "false"}"',
        ]
        if placeholder.placeholder_type:
            attrs.append(f'type="{escape(placeholder.placeholder_type)}"')
        if placeholder.source_count is not None:
            attrs.append(f'source-count="{placeholder.source_count}"')
        if placeholder.original_tokens is not None:
            attrs.append(f'original-tokens="{placeholder.original_tokens}"')
        if placeholder.current_tokens is not None:
            attrs.append(f'current-tokens="{placeholder.current_tokens}"')

        content = (
            f"<context-placeholder {' '.join(attrs)}>\n"
            f"{escape(placeholder.summary)}\n"
            f"{escape(placeholder.reason or '')}\n"
            "</context-placeholder>"
        )
        return {"role": "system", "content": content}

    def validate_sequence(self, items: list[object]) -> list[ValidationIssue]:
        issues = validate_tool_dependencies(items)
        seen_non_system = False
        for item in items:
            if isinstance(item, SystemInstruction) and seen_non_system:
                issues.append(
                    ValidationIssue(
                        code="invalid_role_sequence",
                        message="SystemInstruction must appear before non-system messages",
                    )
                )
            elif not isinstance(item, SystemInstruction):
                seen_non_system = True
        return issues

    def count_tokens(self, items: list[object]) -> int:
        return count_ir_tokens(items)

    def capability(self) -> ProviderCapability:
        return self._capability


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    return json.dumps(content, sort_keys=True)
