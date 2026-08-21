from dataclasses import dataclass
from typing import Callable

from contextos.context.model.enums import ContextItemState
from contextos.context.model.item import ContextItem
from contextos.provider.base.token_counter import ProviderCapability, count_ir_tokens, count_text_tokens


@dataclass(frozen=True)
class TokenBudgetDiagnostics:
    allowed: bool
    current_tokens: int
    max_tokens: int
    remaining_tokens: int

    def to_dict(self) -> dict[str, int | bool]:
        return {
            "allowed": self.allowed,
            "current_tokens": self.current_tokens,
            "max_tokens": self.max_tokens,
            "remaining_tokens": self.remaining_tokens,
        }


def validate_token_budget(items: list[object], capability: ProviderCapability) -> TokenBudgetDiagnostics:
    current = count_ir_tokens(items)
    remaining = capability.max_context_tokens - current
    return TokenBudgetDiagnostics(
        allowed=remaining >= 0,
        current_tokens=current,
        max_tokens=capability.max_context_tokens,
        remaining_tokens=remaining,
    )


def call_provider_if_budget_allows(
    items: list[object],
    capability: ProviderCapability,
    provider_call: Callable[[], object],
) -> TokenBudgetDiagnostics:
    diagnostics = validate_token_budget(items, capability)
    if diagnostics.allowed:
        provider_call()
    return diagnostics


def count_context_panel_tokens(items: list[ContextItem]) -> int:
    return sum(count_text_tokens(_panel_content(item)) for item in items)


def _panel_content(item: ContextItem) -> str:
    if item.state == ContextItemState.ABSTRACT:
        return item.user_override or item.generated_content or ""
    if item.state in {ContextItemState.EVICTED, ContextItemState.REFERENCE}:
        return ""
    return item.effective_content
