from dataclasses import dataclass
from typing import Any

from contextos.provider.base.ir import AssistantMessage, ToolResult


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    severity: str = "error"
    call_id: str | None = None
    group_id: str | None = None
    dependency_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
            "call_id": self.call_id,
            "group_id": self.group_id,
            "dependency_id": self.dependency_id,
        }


def validate_tool_dependencies(items: list[object]) -> list[ValidationIssue]:
    call_ids: set[str] = set()
    result_ids: set[str] = set()
    issues: list[ValidationIssue] = []

    for item in items:
        if isinstance(item, AssistantMessage):
            for tool_call in item.tool_calls:
                call_ids.add(tool_call.call_id)
        elif isinstance(item, ToolResult):
            result_ids.add(item.call_id)

    for call_id in sorted(result_ids - call_ids):
        issues.append(
            ValidationIssue(
                code="unknown_tool_call",
                message=f"ToolResult references unknown ToolCall: {call_id}",
                call_id=call_id,
            )
        )

    for call_id in sorted(call_ids - result_ids):
        issues.append(
            ValidationIssue(
                code="missing_tool_result",
                message=f"ToolCall is missing ToolResult: {call_id}",
                call_id=call_id,
            )
        )

    return issues
