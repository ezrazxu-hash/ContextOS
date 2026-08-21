from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]


def run_command(command: list[str], env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    resolved_command = command.copy()
    executable = shutil.which(resolved_command[0])
    if executable:
        resolved_command[0] = executable
    return subprocess.run(
        resolved_command,
        cwd=REPO_ROOT,
        env=merged_env,
        text=True,
        capture_output=True,
        check=False,
    )


class TestLayerGateTests(unittest.TestCase):
    def test_backend_unit_and_integration_layers_run_independently(self) -> None:
        for layer in ["unit", "integration", "e2e", "performance"]:
            self.assertTrue((REPO_ROOT / "backend" / "tests" / layer).exists(), f"missing backend {layer} test layer")

        unit = run_command([sys.executable, "-m", "unittest", "discover", "-s", "backend/tests/unit", "-p", "test*.py", "-v"])
        integration = run_command([sys.executable, "-m", "unittest", "discover", "-s", "backend/tests/integration", "-p", "test*.py", "-v"])

        self.assertEqual(unit.returncode, 0, unit.stderr)
        self.assertEqual(integration.returncode, 0, integration.stderr)

    def test_ci_failure_probe_makes_unit_gate_fail(self) -> None:
        result = run_command(
            [sys.executable, "-m", "unittest", "discover", "-s", "backend/tests/unit", "-p", "test*.py", "-v"],
            env={"CONTEXTOS_FORCE_CI_FAILURE": "1"},
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("intentional CI failure probe", result.stderr)

    def test_frontend_component_and_e2e_commands_are_unified(self) -> None:
        package_json = json.loads((REPO_ROOT / "studio" / "package.json").read_text(encoding="utf-8"))
        scripts = package_json["scripts"]

        self.assertIn("test", scripts)
        self.assertIn("test:e2e", scripts)

        component = run_command(["npm", "--prefix", "studio", "test"])
        e2e = run_command(["npm", "--prefix", "studio", "run", "test:e2e"])

        self.assertEqual(component.returncode, 0, component.stderr)
        self.assertEqual(e2e.returncode, 0, e2e.stderr)

    def test_ci_workflow_runs_lint_typecheck_unit_and_integration(self) -> None:
        workflow = REPO_ROOT / ".github" / "workflows" / "ci.yml"

        self.assertTrue(workflow.exists(), f"missing CI workflow: {workflow}")
        text = workflow.read_text(encoding="utf-8")
        for required in ["lint", "typecheck", "backend-unit", "backend-integration", "studio-tests"]:
            self.assertIn(required, text)


if __name__ == "__main__":
    unittest.main()
