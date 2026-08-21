from dataclasses import dataclass, field
from typing import Any


def require_non_empty(value: str, field_name: str) -> str:
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


@dataclass(frozen=True)
class SystemInstruction:
    content: str

    def to_dict(self) -> dict[str, Any]:
        return {"type": "system_instruction", "content": self.content}


@dataclass(frozen=True)
class UserMessage:
    content: str

    def to_dict(self) -> dict[str, Any]:
        return {"type": "user_message", "content": self.content}


@dataclass(frozen=True)
class ToolCall:
    call_id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        require_non_empty(self.call_id, "call_id")

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "tool_call",
            "call_id": self.call_id,
            "name": self.name,
            "arguments": dict(self.arguments),
        }


@dataclass(frozen=True)
class AssistantMessage:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "assistant_message",
            "content": self.content,
            "tool_calls": [tool_call.to_dict() for tool_call in self.tool_calls],
        }


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    content: Any

    def __post_init__(self) -> None:
        require_non_empty(self.call_id, "call_id")

    def to_dict(self) -> dict[str, Any]:
        return {"type": "tool_result", "call_id": self.call_id, "content": self.content}


@dataclass(frozen=True)
class ContextPlaceholder:
    placeholder_id: str
    group_id: str
    summary: str
    restorable: bool
    placeholder_type: str | None = None
    source_count: int | None = None
    original_tokens: int | None = None
    current_tokens: int | None = None
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "context_placeholder",
            "placeholder_id": self.placeholder_id,
            "group_id": self.group_id,
            "summary": self.summary,
            "restorable": self.restorable,
            "placeholder_type": self.placeholder_type,
            "source_count": self.source_count,
            "original_tokens": self.original_tokens,
            "current_tokens": self.current_tokens,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class ContextReference:
    reference_id: str
    target_id: str
    label: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "context_reference",
            "reference_id": self.reference_id,
            "target_id": self.target_id,
            "label": self.label,
        }
