from dataclasses import dataclass
import json
from typing import Any


@dataclass(frozen=True)
class ProviderCapability:
    max_context_tokens: int


def count_text_tokens(text: str) -> int:
    return len([token for token in text.split() if token])


def count_ir_tokens(items: list[object]) -> int:
    return sum(count_ir_item_tokens(item) for item in items)


def count_ir_item_tokens(item: object) -> int:
    if hasattr(item, "to_dict"):
        payload = item.to_dict()
    else:
        payload = item

    if not isinstance(payload, dict):
        return count_text_tokens(str(payload))

    return sum(count_text_tokens(str(value)) for value in _token_values(payload))


def _token_values(payload: dict[str, Any]) -> list[Any]:
    values: list[Any] = []
    for key in ("content", "summary", "label", "name"):
        value = payload.get(key)
        if value:
            values.append(value)
    arguments = payload.get("arguments")
    if arguments:
        values.append(json.dumps(arguments, sort_keys=True))
    return values
