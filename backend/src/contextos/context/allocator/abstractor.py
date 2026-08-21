from dataclasses import dataclass
from typing import Callable

from contextos.context.model.item import ContextItem
from contextos.context.policy.state_machine import item_with_generated_content


@dataclass(frozen=True)
class AbstractionResult:
    item: ContextItem
    changed: bool
    error: str | None = None


class ContextAbstractor:
    def __init__(self, generator: Callable[[str], str]) -> None:
        self._generator = generator

    def abstract_item(self, item: ContextItem) -> AbstractionResult:
        try:
            generated_content = self._generator(item.raw_content)
        except Exception as exc:
            return AbstractionResult(item=item, changed=False, error=str(exc))

        return AbstractionResult(
            item=item_with_generated_content(item, generated_content),
            changed=True,
        )
