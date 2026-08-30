from __future__ import annotations

from contextos.runtime.graph.nodes.registry import NodeExecutorRegistry
from contextos.template.compiler.langgraph_compiler import CompiledManifestGraph, LangGraphManifestCompiler
from contextos.template.manifest.schema import TemplateManifest
from contextos.template.validator.validator import ManifestValidationError


class GraphCompileError(Exception):
    def __init__(self, code: str, field_path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field_path = field_path


class GraphCompileService:
    def __init__(self, compiler: LangGraphManifestCompiler | None = None) -> None:
        self._compiler = compiler or LangGraphManifestCompiler()

    def compile(
        self,
        manifest: TemplateManifest,
        *,
        node_executor_registry: NodeExecutorRegistry | None = None,
    ) -> CompiledManifestGraph:
        try:
            return self._compiler.compile(manifest, node_executor_registry=node_executor_registry)
        except ManifestValidationError as exc:
            raise GraphCompileError(exc.code, exc.field_path, str(exc)) from exc
