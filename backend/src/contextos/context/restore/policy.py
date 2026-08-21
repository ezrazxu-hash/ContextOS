from dataclasses import dataclass
from enum import Enum


class RestoreMode(str, Enum):
    AUTO = "AUTO"
    ASK = "ASK"
    MANUAL = "MANUAL"


@dataclass(frozen=True)
class RestorePolicy:
    mode: RestoreMode
    max_tokens_per_restore: int
    max_restore_per_turn: int

