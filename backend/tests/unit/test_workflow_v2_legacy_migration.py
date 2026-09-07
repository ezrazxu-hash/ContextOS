import unittest
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


class WorkflowV2LegacyMigrationTests(unittest.TestCase):
    def test_legacy_copy_creates_empty_v2_definition_for_manual_rebuild(self):
        from contextos.workflow_v2.migration import create_v2_copy_from_legacy_manifest

        legacy_manifest = {
            "id": "legacy-support",
            "name": "Legacy Support",
            "schema_version": "1.0",
            "runtime": {
                "nodes": [
                    {"id": "prompt-1", "type": "prompt"},
                    {"id": "llm-1", "type": "llm"},
                    {"id": "tool-1", "type": "tool"},
                ],
                "edges": [{"from": "prompt-1", "to": "llm-1"}],
            },
            "$state": {"draft": True},
        }

        copied = create_v2_copy_from_legacy_manifest(legacy_manifest)

        self.assertEqual(copied["id"], "legacy-support-v2-copy")
        self.assertEqual(copied["name"], "Legacy Support (V2 Copy)")
        self.assertEqual(copied["schemaVersion"], 2)
        self.assertEqual(copied["nodes"], [])
        self.assertEqual(copied["edges"], [])
        self.assertEqual(copied["migration"]["strategy"], "manual-rebuild")
        self.assertEqual(copied["migration"]["sourceWorkflowId"], "legacy-support")
        self.assertEqual(copied["migration"]["legacyNodeTypes"], ["llm", "prompt", "tool"])
        self.assertNotIn("$state", str(copied))

    def test_cleanup_readiness_reports_v1_inventory_and_zero_v2_legacy_runtime_dependencies(self):
        from contextos.workflow_v2.migration import legacy_cleanup_readiness_report

        report = legacy_cleanup_readiness_report(
            legacy_manifests=[
                {
                    "id": "legacy-support",
                    "name": "Legacy Support",
                    "schema_version": "1.0",
                    "runtime": {"nodes": [{"type": "prompt"}, {"type": "tool"}]},
                },
                {"id": "agent-v2", "name": "Agent V2", "schemaVersion": 2, "nodes": []},
            ],
            v2_source_files={
                "backend/src/contextos/workflow_v2/runtime/runner.py": "class WorkflowV2Runner: pass",
                "backend/src/contextos/runtime/agent/legacy_runtime.py": "class LegacyChatRuntime: pass",
            },
        )

        self.assertEqual(report["legacyWorkflowCount"], 1)
        self.assertEqual(report["legacyWorkflows"][0]["id"], "legacy-support")
        self.assertEqual(report["legacyWorkflows"][0]["nodeTypes"], ["prompt", "tool"])
        self.assertEqual(report["v2LegacyRuntimeDependencies"], [])
        deprecated_paths = {entry["path"] for entry in report["deprecatedPaths"]}
        self.assertNotIn("studio/src/pages/Workflow/WorkflowWorkbench.js", deprecated_paths)
        self.assertNotIn("backend/src/contextos/api/server.py", deprecated_paths)
        self.assertIn("backend/src/contextos/runtime/agent/legacy_runtime.py", deprecated_paths)

    def test_current_workflow_v2_package_has_no_legacy_runtime_dependency(self):
        from contextos.workflow_v2.migration import legacy_cleanup_readiness_report

        workflow_v2_root = Path(__file__).parents[2] / "src" / "contextos" / "workflow_v2"
        source_files = {
            str(path): path.read_text(encoding="utf-8")
            for path in workflow_v2_root.rglob("*.py")
        }

        report = legacy_cleanup_readiness_report(v2_source_files=source_files)

        self.assertEqual(report["v2LegacyRuntimeDependencies"], [])

    def test_readiness_report_from_runtime_store_marks_cleanup_blocked_until_external_checks_pass(self):
        from contextos.runtime.persistence.json_store import JsonRuntimeStore
        from contextos.workflow_v2.migration import legacy_cleanup_readiness_report_from_runtime_store

        with TemporaryDirectory() as temp_dir:
            store = JsonRuntimeStore(Path(temp_dir) / "runtime-state.json")
            store.save_record(
                "templates",
                "legacy-support",
                {
                    "id": "legacy-support",
                    "manifest": {
                        "template": {"id": "legacy-support", "name": "Legacy Support"},
                        "schema_version": "1.0",
                        "runtime": {"nodes": [{"type": "prompt"}, {"type": "llm"}]},
                    },
                },
            )
            store.save_record(
                "workflow_v2_definitions",
                "release-gate",
                {
                    "id": "release-gate",
                    "draft": {"id": "release-gate", "name": "Release Gate", "schemaVersion": 2, "nodes": [], "edges": []},
                    "revision": 1,
                    "updated_at": "2026-09-06T00:00:00+00:00",
                    "versions": [],
                },
            )

            report = legacy_cleanup_readiness_report_from_runtime_store(
                store,
                v2_source_files={"backend/src/contextos/workflow_v2/runtime/runner.py": "class WorkflowV2Runner: pass"},
            )

        self.assertEqual(report["legacyWorkflowCount"], 1)
        self.assertEqual(report["v2WorkflowCount"], 1)
        self.assertEqual(report["cleanupPreconditions"]["noLegacyWorkflows"], False)
        self.assertEqual(report["cleanupPreconditions"]["v2HasNoLegacyRuntimeDependencies"], True)
        self.assertEqual(report["cleanupPreconditions"]["externalCallersRetired"], False)
        self.assertEqual(report["cleanupPreconditions"]["backupVerified"], False)
        self.assertEqual(report["cleanupPreconditions"]["canRemoveLegacy"], False)

    def test_readiness_cli_outputs_json_for_target_runtime_state(self):
        from contextos.runtime.persistence.json_store import JsonRuntimeStore

        with TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "runtime-state.json"
            store = JsonRuntimeStore(state_path)
            store.save_record(
                "templates",
                "legacy-support",
                {
                    "id": "legacy-support",
                    "manifest": {
                        "template": {"id": "legacy-support", "name": "Legacy Support"},
                        "schema_version": "1.0",
                        "runtime": {"nodes": [{"type": "prompt"}]},
                    },
                },
            )

            backend_root = Path(__file__).parents[2]
            env = {**os.environ, "PYTHONPATH": str(backend_root / "src")}
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "contextos.workflow_v2.migration",
                    "--runtime-state",
                    str(state_path),
                ],
                cwd=backend_root,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        report = json.loads(completed.stdout)
        self.assertEqual(report["legacyWorkflowCount"], 1)
        self.assertEqual(report["cleanupPreconditions"]["canRemoveLegacy"], False)


if __name__ == "__main__":
    unittest.main()
