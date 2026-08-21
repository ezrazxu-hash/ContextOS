from dataclasses import dataclass, field
from typing import Any

from contextos.context.compiler.group_validator import validate_group_selection
from contextos.context.compiler.state_resolver import resolve_context_items
from contextos.context.compiler.token_budget import TokenBudgetDiagnostics, validate_token_budget
from contextos.context.compiler.tool_validator import ValidationIssue
from contextos.context.group.model import ContextGroup
from contextos.context.model.item import ContextItem
from contextos.context.model.placeholder import Placeholder
from contextos.provider.base.adapter import ProviderAdapter
from contextos.provider.base.ir import (
    AssistantMessage,
    ContextPlaceholder,
    ContextReference,
    SystemInstruction,
    ToolCall,
    ToolResult,
    UserMessage,
)


@dataclass(frozen=True)
class CompileRequest:
    conversation_items: list[object] = field(default_factory=list)
    context_items: list[ContextItem] = field(default_factory=list)
    groups: list[ContextGroup] = field(default_factory=list)
    selected_item_ids: list[str] | None = None
    placeholders_by_group_id: dict[str, Placeholder] = field(default_factory=dict)


@dataclass(frozen=True)
class CompileResult:
    provider_payload: list[dict[str, Any]]
    diagnostics: dict[str, Any]
    validation_issues: list[ValidationIssue]

    @property
    def allowed(self) -> bool:
        return not self.validation_issues and bool(self.diagnostics["token_budget"]["allowed"])


class ContextCompiler:
    def __init__(self, adapter: ProviderAdapter) -> None:
        self._adapter = adapter

    def compile(self, request: CompileRequest) -> CompileResult:
        selected_item_ids = request.selected_item_ids or [item.id for item in request.context_items]
        group_issues = validate_group_selection(request.groups, selected_item_ids)
        context_ir = resolve_context_items(
            request.context_items,
            selected_item_ids=selected_item_ids,
            placeholders_by_group_id=request.placeholders_by_group_id,
        )
        ir_items = [*request.conversation_items, *context_ir]
        sequence_issues = self._adapter.validate_sequence(ir_items)
        token_budget = validate_token_budget(ir_items, self._adapter.capability())
        issues = [*group_issues, *sequence_issues]
        diagnostics = _diagnostics(token_budget, issues)

        if issues or not token_budget.allowed:
            return CompileResult(provider_payload=[], diagnostics=diagnostics, validation_issues=issues)

        return CompileResult(
            provider_payload=[self._compile_item(item) for item in ir_items],
            diagnostics=diagnostics,
            validation_issues=[],
        )

    def _compile_item(self, item: object) -> dict[str, Any]:
        if isinstance(item, (SystemInstruction, UserMessage, AssistantMessage, ContextReference)):
            return self._adapter.compile_message(item)
        if isinstance(item, ToolCall):
            return self._adapter.compile_tool_call(item)
        if isinstance(item, ToolResult):
            return self._adapter.compile_tool_result(item)
        if isinstance(item, ContextPlaceholder):
            return self._adapter.compile_placeholder(item)
        raise TypeError(f"unsupported IR item: {type(item).__name__}")


def _diagnostics(token_budget: TokenBudgetDiagnostics, issues: list[ValidationIssue]) -> dict[str, Any]:
    return {
        "token_budget": token_budget.to_dict(),
        "validation_issues": [issue.to_dict() for issue in issues],
    }
