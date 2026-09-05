from __future__ import annotations

from contextos.workflow_v2.domain.definitions import workflow_schema_version


class WorkflowRuntimeRouter:
    def __init__(self, *, legacy_runner: object, v2_runner: object) -> None:
        self._legacy_runner = legacy_runner
        self._v2_runner = v2_runner

    def resolve(self, workflow_definition: dict[str, object]) -> object:
        if workflow_schema_version(workflow_definition) == 2:
            return self._v2_runner
        return self._legacy_runner
