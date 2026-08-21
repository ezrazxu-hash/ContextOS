from dataclasses import dataclass
from enum import Enum


class SideEffect(str, Enum):
    NONE = "NONE"
    READ = "READ"
    WRITE = "WRITE"
    EXTERNAL_WRITE = "EXTERNAL_WRITE"
    DESTRUCTIVE = "DESTRUCTIVE"
    FINANCIAL = "FINANCIAL"


class ReplayPolicy(str, Enum):
    AUTO = "AUTO"
    ASK = "ASK"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


@dataclass(frozen=True)
class ToolMetadata:
    tool_id: str
    name: str
    side_effect: SideEffect = SideEffect.WRITE
    idempotent: bool = False
    replay_policy: ReplayPolicy | None = None
    risk_level: RiskLevel = RiskLevel.MEDIUM

    def __post_init__(self) -> None:
        if self.replay_policy is None:
            policy = ReplayPolicy.AUTO if self.side_effect == SideEffect.READ else ReplayPolicy.ASK
            object.__setattr__(self, "replay_policy", policy)

