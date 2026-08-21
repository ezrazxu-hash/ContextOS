from dataclasses import dataclass, replace
from typing import Any


@dataclass(frozen=True)
class RuntimeContext:
    session_id: str
    timeline_id: str
    trace_id: str
    context_api: Any | None = None

    def with_context_api(self, context_api: Any) -> "RuntimeContext":
        return replace(self, context_api=context_api)
