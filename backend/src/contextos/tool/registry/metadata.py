from dataclasses import dataclass
from enum import Enum
from typing import Any


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
    description: str = ""
    side_effect: SideEffect = SideEffect.WRITE
    idempotent: bool = False
    replay_policy: ReplayPolicy | None = None
    risk_level: RiskLevel = RiskLevel.MEDIUM
    input_schema: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None
    config_schema: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.replay_policy is None:
            policy = ReplayPolicy.AUTO if self.side_effect == SideEffect.READ else ReplayPolicy.ASK
            object.__setattr__(self, "replay_policy", policy)

    @property
    def configurable(self) -> bool:
        return bool(self.config_schema)

    def to_catalog_dict(self) -> dict[str, object]:
        return {
            "id": self.tool_id,
            "name": self.name,
            "description": self.description,
            "side_effect": self.side_effect.value,
            "idempotent": self.idempotent,
            "replay_policy": self.replay_policy.value if self.replay_policy is not None else None,
            "risk_level": self.risk_level.value,
            "input_schema": dict(self.input_schema or {}),
            "output_schema": dict(self.output_schema or {}),
            "config_schema": dict(self.config_schema or {}),
            "configurable": self.configurable,
        }
