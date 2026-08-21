from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ReplayAction(str, Enum):
    USE_HISTORY = "USE_HISTORY"
    REINVOKE = "REINVOKE"
    SKIP = "SKIP"
    CANCEL = "CANCEL"


@dataclass(frozen=True)
class ReplayDecision:
    tool_call_id: str
    action: ReplayAction
    tool_id: str | None = None
    confirmation_token: str | None = None
    provenance: dict[str, Any] = field(default_factory=dict)
