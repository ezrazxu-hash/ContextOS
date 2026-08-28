from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class TemplateInfo:
    id: str
    name: str
    version: str


@dataclass(frozen=True)
class NodeSpec:
    id: str
    type: str
    config: dict[str, Any] = field(default_factory=dict)
    position: dict[str, Any] | None = None
    extension: str | None = None


@dataclass(frozen=True)
class EdgeSpec:
    source: str
    target: str
    condition: str | None = None


@dataclass(frozen=True)
class GraphSpec:
    state_schema: str
    nodes: list[NodeSpec]
    edges: list[EdgeSpec]


@dataclass(frozen=True)
class ContextBudgetSpec:
    high_watermark: float
    target_watermark: float


@dataclass(frozen=True)
class ContextRestoreSpec:
    mode: str
    max_tokens_per_restore: int
    max_restore_per_turn: int


@dataclass(frozen=True)
class ContextSpec:
    policy: str
    budget: ContextBudgetSpec
    restore: ContextRestoreSpec


@dataclass(frozen=True)
class CheckpointSpec:
    enabled: bool


@dataclass(frozen=True)
class UiSpec:
    editable_messages: bool
    expose_context_panel: bool


@dataclass(frozen=True)
class TemplateManifest:
    template: TemplateInfo
    graph: GraphSpec
    context: ContextSpec
    checkpoint: CheckpointSpec
    ui: UiSpec
