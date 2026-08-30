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
    name: str | None = None
    config: dict[str, Any] = field(default_factory=dict)
    position: dict[str, Any] | None = None
    extension: str | None = None

    def to_runtime_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"id": self.id, "type": self.type}
        if self.name is not None:
            payload["name"] = self.name
        if self.config:
            payload["config"] = dict(self.config)
        if self.extension is not None:
            payload["extension"] = self.extension
        return payload


@dataclass(frozen=True)
class EdgeSpec:
    source: str
    target: str
    id: str | None = None
    condition: str | None = None
    source_handle: str | None = None
    target_handle: str | None = None
    route: str | None = None

    def to_runtime_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "source_handle": self.source_handle,
            "target_handle": self.target_handle,
            "route": self.route if self.route is not None else self.condition,
        }


@dataclass(frozen=True)
class GraphSpec:
    state_schema: str
    nodes: list[NodeSpec]
    edges: list[EdgeSpec]

    def to_runtime_dict(self) -> dict[str, Any]:
        return {
            "nodes": [node.to_runtime_dict() for node in self.nodes],
            "edges": [edge.to_runtime_dict() for edge in self.edges],
        }


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
    editable_messages: bool = True
    expose_context_panel: bool = True
    nodes: dict[str, Any] = field(default_factory=dict)
    viewport: dict[str, Any] = field(default_factory=dict)

    def to_contract_dict(self) -> dict[str, Any]:
        if self.nodes or self.viewport:
            return {"nodes": dict(self.nodes), "viewport": dict(self.viewport)}
        return {"editable_messages": self.editable_messages, "expose_context_panel": self.expose_context_panel}


@dataclass(frozen=True)
class TemplateManifest:
    template: TemplateInfo
    graph: GraphSpec
    context: ContextSpec
    checkpoint: CheckpointSpec
    ui: UiSpec
    schema_version: str = "1.0"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "runtime": self.graph.to_runtime_dict(),
            "ui": self.ui.to_contract_dict(),
        }
