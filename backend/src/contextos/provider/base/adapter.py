from typing import Any, Protocol, runtime_checkable

from contextos.provider.base.ir import (
    AssistantMessage,
    ContextPlaceholder,
    ContextReference,
    SystemInstruction,
    ToolCall,
    ToolResult,
    UserMessage,
)
from contextos.provider.base.token_counter import ProviderCapability


IRMessage = SystemInstruction | UserMessage | AssistantMessage | ContextReference
CompiledPayload = dict[str, Any]


@runtime_checkable
class ProviderAdapter(Protocol):
    def compile_message(self, message: IRMessage) -> CompiledPayload:
        ...

    def compile_tool_call(self, tool_call: ToolCall) -> CompiledPayload:
        ...

    def compile_tool_result(self, tool_result: ToolResult) -> CompiledPayload:
        ...

    def compile_placeholder(self, placeholder: ContextPlaceholder) -> CompiledPayload:
        ...

    def validate_sequence(self, items: list[object]) -> list[object]:
        ...

    def count_tokens(self, items: list[object]) -> int:
        ...

    def capability(self) -> ProviderCapability:
        ...
