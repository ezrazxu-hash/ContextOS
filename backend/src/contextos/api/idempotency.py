from collections.abc import Callable
from typing import TypeVar


T = TypeVar("T")


class InMemoryIdempotencyStore:
    def __init__(self) -> None:
        self._results: dict[str, object] = {}

    def run_once(self, idempotency_key: str, operation: Callable[[], T]) -> T:
        if idempotency_key not in self._results:
            self._results[idempotency_key] = operation()
        return self._results[idempotency_key]  # type: ignore[return-value]

