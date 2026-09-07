"""Legacy workflow migration boundary helpers for Agent Workflow V2."""

from __future__ import annotations

import argparse
import json
import re
from typing import Any, Mapping

from contextos.runtime.persistence.json_store import JsonRuntimeStore


DEPRECATED_LEGACY_PATHS = [
    {
        "id": "legacy-chat-runtime",
        "path": "backend/src/contextos/runtime/agent/legacy_runtime.py",
        "status": "deprecated",
        "cleanup": "Remove after V1 workflow data and external V1 callers are retired.",
    },
]


def create_v2_copy_from_legacy_manifest(manifest: Mapping[str, Any]) -> dict[str, Any]:
    """Create a safe V2 shell for manual rebuild instead of semantic auto-conversion."""

    source_id = _workflow_id(manifest)
    source_name = _workflow_name(manifest)
    legacy_node_types = sorted(set(_legacy_node_types(manifest)))

    return {
        "id": f"{source_id}-v2-copy",
        "name": f"{source_name} (V2 Copy)",
        "description": f"Manual Agent Workflow V2 rebuild shell copied from legacy workflow {source_id}.",
        "schemaVersion": 2,
        "nodes": [],
        "edges": [],
        "tools": [],
        "runtimeLimits": {},
        "migration": {
            "sourceWorkflowId": source_id,
            "sourceSchemaVersion": str(
                manifest.get("schemaVersion")
                or manifest.get("schema_version")
                or manifest.get("workflow_schema_version")
                or "1"
            ),
            "strategy": "manual-rebuild",
            "legacyNodeTypes": legacy_node_types,
        },
    }


def legacy_cleanup_readiness_report(
    *,
    legacy_manifests: list[Mapping[str, Any]] | None = None,
    v2_source_files: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Return the small inventory needed before V1 cleanup can be considered."""

    legacy_workflows = [
        {
            "id": _workflow_id(manifest),
            "name": _workflow_name(manifest),
            "schemaVersion": str(
                manifest.get("schemaVersion")
                or manifest.get("schema_version")
                or manifest.get("workflow_schema_version")
                or "1"
            ),
            "nodeTypes": sorted(set(_legacy_node_types(manifest))),
        }
        for manifest in legacy_manifests or []
        if not _is_v2_manifest(manifest)
    ]

    return {
        "legacyWorkflowCount": len(legacy_workflows),
        "legacyWorkflows": legacy_workflows,
        "v2LegacyRuntimeDependencies": _v2_legacy_runtime_dependencies(v2_source_files or {}),
        "deprecatedPaths": DEPRECATED_LEGACY_PATHS,
        "oldFieldsPolicy": "preserve-until-final-cleanup",
        "autoMigrationPolicy": "manual-rebuild",
    }


def legacy_cleanup_readiness_report_from_runtime_store(
    store: JsonRuntimeStore,
    *,
    v2_source_files: Mapping[str, str] | None = None,
    external_callers_retired: bool = False,
    backup_verified: bool = False,
) -> dict[str, Any]:
    """Build a T20 cleanup readiness report from the persisted runtime-state store."""

    legacy_manifests: list[Mapping[str, Any]] = []
    for record in store.list_records("templates"):
        manifest = record.get("manifest")
        if isinstance(manifest, Mapping):
            legacy_manifests.append(manifest)
        draft_manifest = record.get("draft_manifest")
        if isinstance(draft_manifest, Mapping):
            legacy_manifests.append(draft_manifest)

    report = legacy_cleanup_readiness_report(
        legacy_manifests=legacy_manifests,
        v2_source_files=v2_source_files,
    )
    report["v2WorkflowCount"] = len(store.list_records("workflow_v2_definitions"))
    report["cleanupPreconditions"] = _cleanup_preconditions(
        report,
        external_callers_retired=external_callers_retired,
        backup_verified=backup_verified,
    )
    return report


def _workflow_id(manifest: Mapping[str, Any]) -> str:
    template = manifest.get("template")
    if isinstance(template, Mapping) and template.get("id"):
        return str(template["id"])
    return str(manifest.get("id") or "legacy-workflow")


def _workflow_name(manifest: Mapping[str, Any]) -> str:
    template = manifest.get("template")
    if isinstance(template, Mapping) and template.get("name"):
        return str(template["name"])
    return str(manifest.get("name") or _workflow_id(manifest))


def _cleanup_preconditions(
    report: Mapping[str, Any],
    *,
    external_callers_retired: bool,
    backup_verified: bool,
) -> dict[str, bool]:
    no_legacy_workflows = int(report.get("legacyWorkflowCount", 0)) == 0
    no_v2_runtime_dependencies = not report.get("v2LegacyRuntimeDependencies")
    return {
        "noLegacyWorkflows": no_legacy_workflows,
        "v2HasNoLegacyRuntimeDependencies": no_v2_runtime_dependencies,
        "externalCallersRetired": external_callers_retired,
        "backupVerified": backup_verified,
        "canRemoveLegacy": all(
            [
                no_legacy_workflows,
                no_v2_runtime_dependencies,
                external_callers_retired,
                backup_verified,
            ]
        ),
    }


def _is_v2_manifest(manifest: Mapping[str, Any]) -> bool:
    raw_version = manifest.get("schemaVersion") or manifest.get("schema_version") or 1
    try:
        return int(float(str(raw_version))) == 2
    except ValueError:
        return False


def _legacy_node_types(manifest: Mapping[str, Any]) -> list[str]:
    nodes = manifest.get("nodes")
    runtime = manifest.get("runtime")
    if not isinstance(nodes, list) and isinstance(runtime, Mapping):
        nodes = runtime.get("nodes")
    if not isinstance(nodes, list):
        return []
    return [str(node.get("type")) for node in nodes if isinstance(node, Mapping) and node.get("type")]


def _v2_legacy_runtime_dependencies(source_files: Mapping[str, str]) -> list[dict[str, str]]:
    dependency_patterns = (
        re.compile(r"^\s*from\s+contextos\.runtime\.agent\.legacy_runtime\s+import\s+", re.MULTILINE),
        re.compile(r"^\s*import\s+contextos\.runtime\.agent\.legacy_runtime\b", re.MULTILINE),
        re.compile(r"\bLegacyChatRuntime\s*\("),
    )
    dependencies = []
    for path, contents in source_files.items():
        normalized_path = path.replace("\\", "/")
        if "/workflow_v2/" not in normalized_path:
            continue
        if any(pattern.search(contents) for pattern in dependency_patterns):
            dependencies.append({"path": path, "reason": "legacy-runtime-reference"})
    return dependencies


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report Agent Workflow V2 legacy cleanup readiness.")
    parser.add_argument("--runtime-state", required=True, help="Path to ContextOS runtime-state.json.")
    parser.add_argument("--external-callers-retired", action="store_true", help="Mark external V1 API callers as retired.")
    parser.add_argument("--backup-verified", action="store_true", help="Mark the backup and rollback plan as verified.")
    args = parser.parse_args(argv)

    report = legacy_cleanup_readiness_report_from_runtime_store(
        JsonRuntimeStore(args.runtime_state),
        external_callers_retired=args.external_callers_retired,
        backup_verified=args.backup_verified,
    )
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
